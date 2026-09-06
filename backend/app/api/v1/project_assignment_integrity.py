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
    if status == "not_found":
        return HTTPException(404, detail={"code": "project_not_found"})
    if status == "already_assigned":
        return HTTPException(
            409,
            detail={"code": "already_assigned", "message": "На объекте уже другой исполнитель"},
        )
    if status == "subscription_required":
        return HTTPException(
            402,
            detail={"code": "subscription_required", "message": "Нужен Pro для нового объекта"},
        )
    return HTTPException(409, detail={"code": "project_assignment_failed"})


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
    try:
        result = await assignment.assign_contractor(
            db,
            project_id=project_id,
            contractor_id=user.id,
            actor_id=user.id,
        )
    except ValueError as error:
        if str(error) == "participant_contractor_invalid":
            raise HTTPException(403, detail={"code": "contractor_invalid"}) from error
        raise
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
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, detail={"code": "project_not_found"})
    if user.role != UserRole.customer or project.customer_id != user.id:
        raise HTTPException(403, detail={"code": "customer_owner_only"})
    contractor = await db.get(User, body.contractor_id)
    if (
        contractor is None
        or contractor.role != UserRole.contractor
        or contractor.deleted_at is not None
    ):
        raise HTTPException(404, detail={"code": "contractor_not_found"})
    result = await assignment.assign_contractor(
        db,
        project_id=project_id,
        contractor_id=contractor.id,
        actor_id=user.id,
    )
    if result.status != "assigned" or result.project is None:
        raise _assignment_error(result.status)
    return await _detail(db, result.project, user)
