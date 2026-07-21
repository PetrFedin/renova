from app.core.timeutil import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import Team, TeamMember, User, Project, ProjectViewer

async def my_team(db: AsyncSession, user_id: str) -> Team | None:
    r = await db.execute(select(TeamMember).where(TeamMember.user_id == user_id))
    m = r.scalar_one_or_none()
    return await db.get(Team, m.team_id) if m else None

async def my_membership(db: AsyncSession, user_id: str) -> TeamMember | None:
    r = await db.execute(select(TeamMember).where(TeamMember.user_id == user_id))
    return r.scalar_one_or_none()

async def create_team(db: AsyncSession, owner_id: str, name: str) -> Team:
    t = Team(name=name, owner_id=owner_id)
    db.add(t); await db.flush()
    db.add(TeamMember(team_id=t.id, user_id=owner_id, role="owner"))
    await db.commit(); await db.refresh(t); return t

async def list_members(db: AsyncSession, team_id: str) -> list[dict]:
    r = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))
    out = []
    for m in r.scalars().all():
        u = await db.get(User, m.user_id)
        out.append({"user_id": m.user_id, "phone": u.phone if u else "", "role": m.role})
    return out

async def invite_phone(db: AsyncSession, team_id: str, phone: str, role: str = "member") -> dict:
    r = await db.execute(select(User).where(User.phone == phone.strip()))
    u = r.scalar_one_or_none()
    if not u or u.role.value != "contractor":
        return {"ok": False, "message": "Исполнитель не найден"}
    ex = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == u.id))
    if ex.scalar_one_or_none():
        return {"ok": False, "message": "Уже в бригаде"}
    db.add(TeamMember(team_id=team_id, user_id=u.id, role=role))
    await db.commit()
    try:
        from app.services import notification_service as ns
        await ns.notify(db, user_id=u.id, project_id=None, notification_type="chat_message", title="Приглашение в бригаду", body="Вас добавили в бригаду Renova", link_path="/(contractor)/(tabs)/profile", return_to="/(contractor)/(tabs)/")
    except Exception:
        pass
    return {"ok": True, "user_id": u.id}

async def team_owner_ids(db: AsyncSession, user_id: str) -> set[str]:
    """ID владельцев бригад, где пользователь состоит."""
    r = await db.execute(select(TeamMember).where(TeamMember.user_id == user_id))
    m = r.scalar_one_or_none()
    if not m:
        return set()
    t = await db.get(Team, m.team_id)
    return {t.owner_id} if t else set()

async def is_project_guest(db: AsyncSession, user_id: str, project_id: str) -> bool:
    r = await db.execute(select(ProjectViewer).where(ProjectViewer.project_id == project_id, ProjectViewer.user_id == user_id))
    return r.scalar_one_or_none() is not None


async def project_access_mode(db: AsyncSession, user: User, project: Project) -> tuple[str, bool]:
    """(access_mode, read_only). Только 2 роли + гостевой доступ."""
    if project.customer_id == user.id:
        return "owner", False
    if project.contractor_id == user.id:
        return "contractor", False
    if user.role.value == "contractor":
        owners = await team_owner_ids(db, user.id)
        if project.contractor_id in owners:
            mem = await my_membership(db, user.id)
            # viewer — read-only; foreman/member — write на объекте (не финансы/lock)
            ro = mem is not None and mem.role == "viewer"
            return "contractor", ro
        if project.contractor_id is None:
            mem = await my_membership(db, user.id)
            # viewer — read-only; foreman/member — write на объекте (не финансы/lock)
            ro = mem is not None and mem.role == "viewer"
            return "contractor", ro
    if await is_project_guest(db, user.id, project.id):
        return "guest", True
    return "none", True



async def is_contractor_owner(db: AsyncSession, user: User, project: Project) -> bool:
    """W68 #43: владелец бригады / назначенный contractor_id — не member/foreman."""
    if project.contractor_id == user.id:
        return True
    return False


async def team_role_for_project(db: AsyncSession, user: User, project: Project) -> str | None:
    """Роль в бригаде исполнителя проекта: owner|foreman|member|viewer|None."""
    if project.contractor_id == user.id:
        return "owner"
    if user.role.value != "contractor":
        return None
    owners = await team_owner_ids(db, user.id)
    if project.contractor_id not in owners and project.contractor_id is not None:
        return None
    mem = await my_membership(db, user.id)
    return mem.role if mem else None


async def can_access_project(db: AsyncSession, user: User, project: Project, write: bool = False) -> bool:
    mode, read_only = await project_access_mode(db, user, project)
    if mode == "none":
        return False
    if write and read_only:
        return False
    return True

import secrets
from datetime import datetime, timedelta
from app.models.entities import TeamInvite



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

async def create_invite_link(db: AsyncSession, team_id: str, role: str = "member", hours: int = 72) -> dict:
    token = secrets.token_urlsafe(16)
    inv = TeamInvite(team_id=team_id, token=token, role=role, expires_at=utc_now() + timedelta(hours=hours))
    db.add(inv); await db.commit()
    return {"token": token, "link": f"renova://team/join/{token}"}

async def join_by_token(db: AsyncSession, user_id: str, token: str) -> dict:
    r = await db.execute(select(TeamInvite).where(TeamInvite.token == token, TeamInvite.used.is_(False)))
    inv = r.scalar_one_or_none()
    if not inv or inv.expires_at < utc_now():
        return {"ok": False, "message": "Ссылка недействительна"}
    ex = await db.execute(select(TeamMember).where(TeamMember.team_id == inv.team_id, TeamMember.user_id == user_id))
    if not ex.scalar_one_or_none():
        db.add(TeamMember(team_id=inv.team_id, user_id=user_id, role=inv.role))
    inv.used = True
    await db.commit()
    return {"ok": True, "team_id": inv.team_id}

async def set_member_role(db: AsyncSession, team_id: str, owner_id: str, user_id: str, role: str) -> bool:
    t = await db.get(Team, team_id)
    if not t or t.owner_id != owner_id:
        return False
    r = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id))
    m = r.scalar_one_or_none()
    if not m or m.role == "owner":
        return False
    m.role = role
    await db.commit()
    return True
