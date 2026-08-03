from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import secrets
import uuid

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    Project,
    ProjectViewer,
    Team,
    TeamInvite,
    TeamMember,
    User,
    UserRole,
)
from app.services import outbox_service as outbox

TEAM_MEMBER_ROLES = frozenset({"member", "viewer", "foreman"})


@dataclass(frozen=True)
class TeamMutationResult:
    team: Team
    replayed: bool


@dataclass(frozen=True)
class TeamInviteResult:
    team: Team
    invite: TeamInvite
    team_replayed: bool


class _MembershipAlreadyExists(RuntimeError):
    """Internal race signal used to roll back a prepared notification."""


def _valid_member_role(role: str) -> bool:
    return role in TEAM_MEMBER_ROLES


def _normalize_team_name(name: str) -> str:
    normalized = (name or "").strip()
    if not normalized or len(normalized) > 255:
        raise ValueError("invalid_team_name")
    return normalized


async def _locked_user(db: AsyncSession, user_id: str) -> User | None:
    query = select(User).where(User.id == user_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _locked_team(db: AsyncSession, team_id: str) -> Team | None:
    query = select(Team).where(Team.id == team_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _locked_member(
    db: AsyncSession,
    *,
    team_id: str,
    user_id: str,
) -> TeamMember | None:
    query = select(TeamMember).where(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def owned_team(db: AsyncSession, owner_id: str) -> Team | None:
    return await db.scalar(
        select(Team)
        .where(Team.owner_id == owner_id)
        .order_by(Team.created_at.asc(), Team.id.asc())
    )


async def my_team(db: AsyncSession, user_id: str) -> Team | None:
    """An owned team always wins over unrelated older memberships."""
    owned = await owned_team(db, user_id)
    if owned is not None:
        return owned
    result = await db.execute(
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == user_id)
        .order_by(Team.created_at.asc(), Team.id.asc())
    )
    return result.scalars().first()


async def my_membership(db: AsyncSession, user_id: str) -> TeamMember | None:
    owned = await owned_team(db, user_id)
    if owned is not None:
        return await _find_team_membership(
            db,
            team_id=owned.id,
            user_id=user_id,
        )
    result = await db.execute(
        select(TeamMember)
        .where(TeamMember.user_id == user_id)
        .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
    )
    return result.scalars().first()


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


async def _ensure_owner_membership(
    db: AsyncSession,
    *,
    team: Team,
) -> TeamMember:
    existing = await _find_team_membership(
        db,
        team_id=team.id,
        user_id=team.owner_id,
    )
    if existing is not None:
        if existing.role != "owner":
            existing.role = "owner"
            await db.flush()
        return existing
    member = TeamMember(team_id=team.id, user_id=team.owner_id, role="owner")
    db.add(member)
    await db.flush()
    return member


async def ensure_team_membership(
    db: AsyncSession,
    *,
    team_id: str,
    user_id: str,
    role: str,
) -> tuple[TeamMember, bool]:
    """Idempotent membership upsert that remains in the caller transaction.

    SQLite can treat a first-operation SAVEPOINT as the effective outer transaction,
    so releasing ``begin_nested()`` may make a row survive a later rollback. Native
    conflict-ignore inserts avoid that behavior and keep membership plus outbox under
    the exact same transaction boundary on SQLite and PostgreSQL.
    """
    if not _valid_member_role(role):
        raise ValueError("invalid_team_role")
    existing = await _find_team_membership(db, team_id=team_id, user_id=user_id)
    if existing is not None:
        return existing, False

    candidate_id = str(uuid.uuid4())
    values = {
        "id": candidate_id,
        "team_id": team_id,
        "user_id": user_id,
        "role": role,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = (
            postgresql_insert(TeamMember)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["team_id", "user_id"])
            .returning(TeamMember.id)
        )
    elif dialect == "sqlite":
        statement = (
            sqlite_insert(TeamMember)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["team_id", "user_id"])
            .returning(TeamMember.id)
        )
    else:
        member = TeamMember(**values)
        db.add(member)
        await db.flush()
        return member, True

    inserted_id = (await db.execute(statement)).scalar_one_or_none()
    member = await _find_team_membership(db, team_id=team_id, user_id=user_id)
    if member is None:
        raise RuntimeError("team_membership_upsert_missing")
    return member, inserted_id is not None


async def _get_or_create_owned_team_locked(
    db: AsyncSession,
    *,
    owner: User,
    name: str,
) -> TeamMutationResult:
    existing = await owned_team(db, owner.id)
    if existing is not None:
        await _ensure_owner_membership(db, team=existing)
        return TeamMutationResult(existing, True)

    team = Team(name=_normalize_team_name(name), owner_id=owner.id)
    db.add(team)
    await db.flush()
    await _ensure_owner_membership(db, team=team)
    return TeamMutationResult(team, False)


async def create_or_get_team(
    db: AsyncSession,
    owner_id: str,
    name: str,
) -> TeamMutationResult:
    """Create at most one owned team under the owner user row lock."""
    owner = await _locked_user(db, owner_id)
    if owner is None:
        await db.rollback()
        raise ValueError("team_owner_not_found")
    if owner.role != UserRole.contractor:
        await db.rollback()
        raise ValueError("team_owner_contractor_only")
    try:
        result = await _get_or_create_owned_team_locked(
            db,
            owner=owner,
            name=name,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(result.team)
    return result


async def create_team(db: AsyncSession, owner_id: str, name: str) -> Team:
    """Compatibility wrapper for older callers."""
    return (await create_or_get_team(db, owner_id, name)).team


async def list_members(db: AsyncSession, team_id: str) -> list[dict]:
    """List members in one query, preserving the established response shape."""
    rows = (
        await db.execute(
            select(TeamMember, User.phone)
            .outerjoin(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id == team_id)
            .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
        )
    ).all()
    return [
        {
            "user_id": member.user_id,
            "phone": phone or "",
            "role": member.role,
        }
        for member, phone in rows
    ]


async def _enqueue_notification(
    db: AsyncSession,
    *,
    team_id: str,
    user_id: str,
    title: str,
    body: str,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="team",
        aggregate_id=team_id,
        event_type=outbox.NOTIFICATION_EVENT,
        payload={
            "user_id": user_id,
            "project_id": None,
            "notification_type": "chat_message",
            "title": title,
            "body": body,
            "link_path": "/(contractor)/(tabs)/profile",
            "return_to": "/(contractor)/(tabs)/",
        },
    )


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def _invite_phone_for_team(
    db: AsyncSession,
    *,
    team: Team,
    phone: str,
    role: str,
) -> dict:
    if not _valid_member_role(role):
        return {"ok": False, "message": "Некорректная роль"}
    normalized_phone = phone.strip()
    target = await db.scalar(select(User).where(User.phone == normalized_phone))
    if target is None or target.role != UserRole.contractor:
        return {"ok": False, "message": "Исполнитель не найден"}

    existing = await _find_team_membership(
        db,
        team_id=team.id,
        user_id=target.id,
    )
    if existing is not None:
        return {"ok": False, "message": "Уже в бригаде"}

    # Prepare the durable effect before mutating membership. If effect preparation
    # fails, there is no membership DML to leak through SQLite legacy autocommit.
    await _enqueue_notification(
        db,
        team_id=team.id,
        user_id=target.id,
        title="Приглашение в бригаду",
        body=f"Вас добавили в бригаду «{team.name}»",
    )
    _member, created = await ensure_team_membership(
        db,
        team_id=team.id,
        user_id=target.id,
        role=role,
    )
    if not created:
        raise _MembershipAlreadyExists("team_membership_race_lost")
    return {"ok": True, "user_id": target.id}


async def invite_phone_as_owner(
    db: AsyncSession,
    *,
    owner_id: str,
    phone: str,
    role: str = "member",
) -> dict:
    """Owner-scoped direct membership mutation with durable notification."""
    owner = await _locked_user(db, owner_id)
    if owner is None or owner.role != UserRole.contractor:
        await db.rollback()
        raise ValueError("team_owner_contractor_only")
    team = await owned_team(db, owner.id)
    if team is None:
        await db.rollback()
        raise ValueError("team_not_found")
    team = await _locked_team(db, team.id)
    if team is None or team.owner_id != owner.id:
        await db.rollback()
        raise ValueError("team_owner_only")
    try:
        result = await _invite_phone_for_team(
            db,
            team=team,
            phone=phone,
            role=role,
        )
        await db.commit()
    except _MembershipAlreadyExists:
        await db.rollback()
        return {"ok": False, "message": "Уже в бригаде"}
    except BaseException:
        await db.rollback()
        raise
    if result.get("ok"):
        await _dispatch(db, "team.invite_phone")
    return result


async def invite_phone(
    db: AsyncSession,
    team_id: str,
    phone: str,
    role: str = "member",
) -> dict:
    """Compatibility path with the same atomic membership/outbox contract."""
    team = await _locked_team(db, team_id)
    if team is None:
        await db.rollback()
        return {"ok": False, "message": "Бригада не найдена"}
    try:
        result = await _invite_phone_for_team(
            db,
            team=team,
            phone=phone,
            role=role,
        )
        await db.commit()
    except _MembershipAlreadyExists:
        await db.rollback()
        return {"ok": False, "message": "Уже в бригаде"}
    except BaseException:
        await db.rollback()
        raise
    if result.get("ok"):
        await _dispatch(db, "team.invite_phone")
    return result


async def team_owner_ids(db: AsyncSession, user_id: str) -> set[str]:
    """All team-owner IDs for every team membership of the user."""
    result = await db.execute(
        select(Team.owner_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == user_id)
    )
    return set(result.scalars().all())


async def project_team_membership(
    db: AsyncSession,
    *,
    user_id: str,
    contractor_id: str | None,
) -> TeamMember | None:
    """Membership in a team owned by the contractor assigned to the project."""
    if contractor_id is None:
        return None
    result = await db.execute(
        select(TeamMember)
        .join(Team, Team.id == TeamMember.team_id)
        .where(
            TeamMember.user_id == user_id,
            Team.owner_id == contractor_id,
        )
        .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
    )
    return result.scalars().first()


async def is_project_guest(db: AsyncSession, user_id: str, project_id: str) -> bool:
    result = await db.execute(
        select(ProjectViewer).where(
            ProjectViewer.project_id == project_id,
            ProjectViewer.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def project_access_mode(db: AsyncSession, user: User, project: Project) -> tuple[str, bool]:
    """Return explicit project access; unassigned projects are not contractor-readable."""
    if project.customer_id == user.id:
        return "owner", False
    if project.contractor_id == user.id:
        return "contractor", False
    if user.role == UserRole.contractor:
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
    return project.contractor_id == user.id


async def team_role_for_project(db: AsyncSession, user: User, project: Project) -> str | None:
    """Role in the assigned contractor's team, never in an unrelated project."""
    if project.contractor_id == user.id:
        return "owner"
    if user.role != UserRole.contractor:
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


async def create_owner_invite(
    db: AsyncSession,
    *,
    owner_id: str,
    role: str = "member",
    hours: int = 72,
    default_team_name: str = "Бригада",
) -> TeamInviteResult:
    """Create/get the owned team and invite in one transaction."""
    if not _valid_member_role(role):
        raise ValueError("invalid_team_role")
    if hours < 1 or hours > 24 * 30:
        raise ValueError("invalid_invite_lifetime")
    owner = await _locked_user(db, owner_id)
    if owner is None or owner.role != UserRole.contractor:
        await db.rollback()
        raise ValueError("team_owner_contractor_only")
    try:
        team_result = await _get_or_create_owned_team_locked(
            db,
            owner=owner,
            name=default_team_name,
        )
        invite = TeamInvite(
            team_id=team_result.team.id,
            token=secrets.token_urlsafe(16),
            role=role,
            expires_at=utc_now() + timedelta(hours=hours),
        )
        db.add(invite)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(team_result.team)
    await db.refresh(invite)
    return TeamInviteResult(team_result.team, invite, team_result.replayed)


async def create_invite_link(
    db: AsyncSession,
    team_id: str,
    role: str = "member",
    hours: int = 72,
) -> dict:
    """Compatibility helper for an already-authorized team."""
    if not _valid_member_role(role):
        raise ValueError("invalid_team_role")
    if hours < 1 or hours > 24 * 30:
        raise ValueError("invalid_invite_lifetime")
    team = await _locked_team(db, team_id)
    if team is None:
        await db.rollback()
        raise ValueError("team_not_found")
    try:
        invite = TeamInvite(
            team_id=team.id,
            token=secrets.token_urlsafe(16),
            role=role,
            expires_at=utc_now() + timedelta(hours=hours),
        )
        db.add(invite)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return {"token": invite.token, "link": f"renova://team/join/{invite.token}"}


async def join_by_token(db: AsyncSession, user_id: str, token: str) -> dict:
    """Atomically consume a single-use invite and add one contractor membership."""
    normalized = token.strip()
    if not normalized:
        return {"ok": False, "message": "Ссылка недействительна"}

    user = await _locked_user(db, user_id)
    if user is None or user.role != UserRole.contractor:
        await db.rollback()
        return {"ok": False, "message": "Только исполнитель может вступить в бригаду"}

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
    team = await _locked_team(db, team_id)
    if team is None:
        await db.rollback()
        return {"ok": False, "message": "Ссылка недействительна"}
    try:
        _member, created = await ensure_team_membership(
            db,
            team_id=team_id,
            user_id=user.id,
            role=role,
        )
        if created:
            await _enqueue_notification(
                db,
                team_id=team.id,
                user_id=team.owner_id,
                title="Новый участник бригады",
                body=f"Исполнитель {user.phone} присоединился к «{team.name}»",
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    if created:
        await _dispatch(db, "team.join")
    return {"ok": True, "team_id": team_id}


async def set_member_role(
    db: AsyncSession,
    team_id: str,
    owner_id: str,
    user_id: str,
    role: str,
) -> bool:
    """Owner-only atomic role change with durable member notification."""
    if not _valid_member_role(role):
        return False
    owner = await _locked_user(db, owner_id)
    if owner is None or owner.role != UserRole.contractor:
        await db.rollback()
        return False
    team = await _locked_team(db, team_id)
    if team is None or team.owner_id != owner.id:
        await db.rollback()
        return False
    member = await _locked_member(db, team_id=team.id, user_id=user_id)
    if member is None or member.role == "owner":
        await db.rollback()
        return False
    if member.role == role:
        await db.commit()
        return True
    try:
        member.role = role
        await _enqueue_notification(
            db,
            team_id=team.id,
            user_id=member.user_id,
            title="Изменена роль в бригаде",
            body=f"Новая роль: {role}",
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await _dispatch(db, "team.member_role")
    return True


async def set_member_role_as_owner(
    db: AsyncSession,
    *,
    owner_id: str,
    user_id: str,
    role: str,
) -> bool:
    team = await owned_team(db, owner_id)
    if team is None:
        return False
    return await set_member_role(db, team.id, owner_id, user_id, role)
