import logging
import secrets
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    Project,
    ProjectViewer,
    Team,
    TeamInvite,
    TeamMember,
    User,
)

logger = logging.getLogger(__name__)
TEAM_MEMBER_ROLES = frozenset({"member", "viewer", "foreman"})


def _valid_member_role(role: str) -> bool:
    return role in TEAM_MEMBER_ROLES


async def my_team(db: AsyncSession, user_id: str) -> Team | None:
    r = await db.execute(
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == user_id)
        .order_by(Team.created_at.asc(), Team.id.asc())
    )
    return r.scalars().first()


async def my_membership(db: AsyncSession, user_id: str) -> TeamMember | None:
    r = await db.execute(
        select(TeamMember)
        .where(TeamMember.user_id == user_id)
        .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
    )
    return r.scalars().first()


async def create_team(db: AsyncSession, owner_id: str, name: str) -> Team:
    t = Team(name=name, owner_id=owner_id)
    db.add(t)
    await db.flush()
    db.add(TeamMember(team_id=t.id, user_id=owner_id, role="owner"))
    await db.commit()
    await db.refresh(t)
    return t


async def list_members(db: AsyncSession, team_id: str) -> list[dict]:
    r = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))
    out = []
    for m in r.scalars().all():
        u = await db.get(User, m.user_id)
        out.append({"user_id": m.user_id, "phone": u.phone if u else "", "role": m.role})
    return out


async def _find_team_membership(
    db: AsyncSession,
    *,
    team_id: str,
    user_id: str,
) -> TeamMember | None:
    return await db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
        )
    )


async def ensure_team_membership(
    db: AsyncSession,
    *,
    team_id: str,
    user_id: str,
    role: str,
) -> tuple[TeamMember, bool]:
    """Create one membership without committing; concurrent duplicates are idempotent."""
    if not _valid_member_role(role):
        raise ValueError("invalid_team_role")
    existing = await _find_team_membership(db, team_id=team_id, user_id=user_id)
    if existing is not None:
        return existing, False

    member = TeamMember(team_id=team_id, user_id=user_id, role=role)
    try:
        async with db.begin_nested():
            db.add(member)
            await db.flush()
    except IntegrityError:
        existing = await _find_team_membership(db, team_id=team_id, user_id=user_id)
        if existing is None:
            raise
        return existing, False
    return member, True


async def invite_phone(db: AsyncSession, team_id: str, phone: str, role: str = "member") -> dict:
    if not _valid_member_role(role):
        return {"ok": False, "message": "Некорректная роль"}
    r = await db.execute(select(User).where(User.phone == phone.strip()))
    u = r.scalar_one_or_none()
    if not u or u.role.value != "contractor":
        return {"ok": False, "message": "Исполнитель не найден"}

    _member, created = await ensure_team_membership(
        db,
        team_id=team_id,
        user_id=u.id,
        role=role,
    )
    if not created:
        await db.rollback()
        return {"ok": False, "message": "Уже в бригаде"}
    await db.commit()

    try:
        from app.services import notification_service as ns

        await ns.notify(
            db,
            user_id=u.id,
            project_id=None,
            notification_type="chat_message",
            title="Приглашение в бригаду",
            body="Вас добавили в бригаду Renova",
            link_path="/(contractor)/(tabs)/profile",
            return_to="/(contractor)/(tabs)/",
        )
    except Exception:
        logger.exception(
            "team membership notification failed team_id=%s user_id=%s",
            team_id,
            u.id,
        )
    return {"ok": True, "user_id": u.id}


async def team_owner_ids(db: AsyncSession, user_id: str) -> set[str]:
    """All team-owner IDs for every team membership of the user."""
    r = await db.execute(
        select(Team.owner_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == user_id)
    )
    return set(r.scalars().all())


async def project_team_membership(
    db: AsyncSession,
    *,
    user_id: str,
    contractor_id: str | None,
) -> TeamMember | None:
    """Membership in a team owned by the contractor assigned to the project."""
    if contractor_id is None:
        return None
    r = await db.execute(
        select(TeamMember)
        .join(Team, Team.id == TeamMember.team_id)
        .where(
            TeamMember.user_id == user_id,
            Team.owner_id == contractor_id,
        )
        .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
    )
    return r.scalars().first()


async def is_project_guest(db: AsyncSession, user_id: str, project_id: str) -> bool:
    r = await db.execute(
        select(ProjectViewer).where(
            ProjectViewer.project_id == project_id,
            ProjectViewer.user_id == user_id,
        )
    )
    return r.scalar_one_or_none() is not None


async def project_access_mode(db: AsyncSession, user: User, project: Project) -> tuple[str, bool]:
    """Return explicit project access; unassigned projects are not contractor-readable."""
    if project.customer_id == user.id:
        return "owner", False
    if project.contractor_id == user.id:
        return "contractor", False
    if user.role.value == "contractor":
        membership = await project_team_membership(
            db,
            user_id=user.id,
            contractor_id=project.contractor_id,
        )
        if membership is not None:
            return "contractor", membership.role == "viewer"
    if await is_project_guest(db, user.id, project.id):
        return "guest", True
    return "none", True


async def is_contractor_owner(db: AsyncSession, user: User, project: Project) -> bool:
    """W68 #43: владелец бригады / назначенный contractor_id — не member/foreman."""
    return project.contractor_id == user.id


async def team_role_for_project(db: AsyncSession, user: User, project: Project) -> str | None:
    """Role in the assigned contractor's team, never in an unrelated/unassigned project."""
    if project.contractor_id == user.id:
        return "owner"
    if user.role.value != "contractor":
        return None
    membership = await project_team_membership(
        db,
        user_id=user.id,
        contractor_id=project.contractor_id,
    )
    return membership.role if membership is not None else None


async def can_access_project(db: AsyncSession, user: User, project: Project, write: bool = False) -> bool:
    mode, read_only = await project_access_mode(db, user, project)
    if mode == "none":
        return False
    if write and read_only:
        return False
    return True


async def require_capability(
    db: AsyncSession,
    user: User,
    project: Project,
    capability: str,
) -> str | None:
    """W73: матрица прав бригады на объекте.

    capability:
      field_write — замечания/punch (owner|foreman|member|customer)
      escalate — спор (owner|foreman|customer)
      schedule — план-график (owner|foreman; customer отдельно)
      estimate_lock — lock/propose сметы (только contractor owner)
    Возвращает team_role или "customer".
    """
    from fastapi import HTTPException

    if project.customer_id == user.id:
        if capability == "estimate_lock":
            raise HTTPException(403, "estimate_lock_contractor_owner_only")
        return "customer"

    role = await team_role_for_project(db, user, project)
    if role is None and user.id != project.contractor_id:
        raise HTTPException(403, "project_forbidden")

    effective = role or ("owner" if user.id == project.contractor_id else None)
    if capability == "field_write":
        if effective in ("owner", "foreman", "member"):
            return effective
        raise HTTPException(403, "field_write_forbidden")
    if capability == "escalate":
        if effective in ("owner", "foreman"):
            return effective
        raise HTTPException(403, "escalate_foreman_or_owner_only")
    if capability == "schedule":
        if effective in ("owner", "foreman"):
            return effective
        raise HTTPException(403, "schedule_foreman_or_owner_only")
    if capability == "estimate_lock":
        if effective == "owner":
            return effective
        raise HTTPException(403, "estimate_lock_contractor_owner_only")
    raise HTTPException(400, f"unknown_capability:{capability}")


async def create_invite_link(
    db: AsyncSession,
    team_id: str,
    role: str = "member",
    hours: int = 72,
) -> dict:
    if not _valid_member_role(role):
        raise ValueError("invalid_team_role")
    token = secrets.token_urlsafe(16)
    inv = TeamInvite(
        team_id=team_id,
        token=token,
        role=role,
        expires_at=utc_now() + timedelta(hours=hours),
    )
    db.add(inv)
    await db.commit()
    return {"token": token, "link": f"renova://team/join/{token}"}


async def join_by_token(db: AsyncSession, user_id: str, token: str) -> dict:
    """Atomically consume a single-use invite and add one idempotent membership."""
    normalized = token.strip()
    if not normalized:
        return {"ok": False, "message": "Ссылка недействительна"}

    claimed = await db.execute(
        update(TeamInvite)
        .where(
            TeamInvite.token == normalized,
            TeamInvite.used.is_(False),
            TeamInvite.expires_at >= utc_now(),
        )
        .values(used=True)
        .returning(TeamInvite.team_id, TeamInvite.role)
    )
    row = claimed.first()
    if row is None:
        await db.rollback()
        return {"ok": False, "message": "Ссылка недействительна"}

    team_id, role = row
    try:
        await ensure_team_membership(
            db,
            team_id=team_id,
            user_id=user_id,
            role=role,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {"ok": True, "team_id": team_id}


async def set_member_role(
    db: AsyncSession,
    team_id: str,
    owner_id: str,
    user_id: str,
    role: str,
) -> bool:
    if not _valid_member_role(role):
        return False
    t = await db.get(Team, team_id)
    if not t or t.owner_id != owner_id:
        return False
    r = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
        )
    )
    m = r.scalar_one_or_none()
    if not m or m.role == "owner":
        return False
    m.role = role
    await db.commit()
    return True
