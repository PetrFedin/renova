"""Роль актёра внутри проекта — для денежных и параметрических правок.

`require_project(write=True)` отвечает лишь на вопрос «есть ли право записи»
(владелец-заказчик, ведущий исполнитель или любой не-viewer участник его
бригады). Деньги и параметры проекта решает заказчик, поэтому там нужна роль.
Принцип: заказчик решает по деньгам и параметрам, исполнитель исполняет.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User
from app.services import team_service as team_svc

ROLE_CUSTOMER = "customer"  # владелец проекта (project.customer_id)
ROLE_LEAD = "lead"  # ведущий исполнитель (project.contractor_id)
ROLE_FOREMAN = "foreman"  # прораб бригады ведущего
ROLE_MEMBER = "member"  # рядовой участник бригады ведущего
ROLE_VIEWER = "viewer"  # наблюдатель бригады (только чтение)
ROLE_GUEST = "guest"  # гость проекта (только чтение)
ROLE_NONE = "none"


async def project_actor_role(db: AsyncSession, user: User, project: Project) -> str:
    """Точная роль пользователя в проекте (без учёта технадзора — он read-only)."""
    if project.customer_id == user.id:
        return ROLE_CUSTOMER
    if project.contractor_id == user.id:
        return ROLE_LEAD
    team_role = await team_svc.team_role_for_project(db, user, project)
    if team_role in (ROLE_FOREMAN, ROLE_MEMBER, ROLE_VIEWER):
        return team_role
    mode, _ = await team_svc.project_access_mode(db, user, project)
    return ROLE_GUEST if mode == "guest" else ROLE_NONE


async def require_project_owner(db: AsyncSession, user: User, project: Project, *, action: str) -> None:
    """403, если действие не заказчика-владельца. `action` — что именно запрещено."""
    if await project_actor_role(db, user, project) != ROLE_CUSTOMER:
        raise HTTPException(
            403,
            detail={
                "code": "customer_only",
                "message": f"{action} может только заказчик — владелец объекта",
            },
        )
