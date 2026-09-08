"""Canonical project lead-assignment routes with race-safe status semantics."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import project_assignment_service as assignment

router = APIRouter(prefix="/projects", tags=["projects"])


class LinkContractorIn(BaseModel):
    contractor_id: str = Field(min_length=1, max_length=36)


def _assignment_error(status: str) -> HTTPException:
    errors = {
        "not_found": (404, "project_not_found", "Объект не найден"),
        "already_assigned": (409, "already_assigned", "На объекте уже другой исполнитель"),
        "subscription_required": (402, "subscription_required", "Нужен Pro для нового объекта"),
        "forbidden": (403, "customer_owner_only", "Недостаточно прав для назначения исполнителя"),
        "project_trashed": (409, "project_trashed", "Сначала восстановите объект из корзины"),
        "contractor_invalid": (404, "contractor_not_found", "Исполнитель не найден"),
    }
    code, detail, message = errors.get(
        status, (409, "project_assignment_failed", "Не удалось назначить исполнителя"),
    )
    return HTTPException(code, detail={"code": detail, "message": message})


async def _detail(db: AsyncSession, project: Project, user: User):
    from app.api.v1.projects import _detail as project_detail

    return await project_detail(db, project, user)


@router.post("/{project_id}/assign")
async def assign_contractor(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})
    result = await assignment.assign_contractor(
        db, project_id=project_id, contractor_id=user.id, actor_id=user.id,
    )
    if result.status != "assigned" or result.project is None:
        raise _assignment_error(result.status)
    return await _detail(db, result.project, user)


@router.post("/{project_id}/contractor")
async def link_contractor(
    project_id: str,
    body: LinkContractorIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_owner_only"})
    # The service validates current ownership, target and lifecycle under the
    # same project lock used for assignment, rather than trusting a stale read.
    result = await assignment.assign_contractor(
        db, project_id=project_id, contractor_id=body.contractor_id, actor_id=user.id,
    )
    if result.status != "assigned" or result.project is None:
        raise _assignment_error(result.status)
    return await _detail(db, result.project, user)
