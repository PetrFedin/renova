"""Canonical request/return routes for work acceptance mutations."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.portal import _portal_claims, _require_portal_scope
from app.api.v1.work_acceptances import (
    acceptance_dict,
    require_acceptance_decider,
    require_acceptance_requester,
)
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services.acceptance_mutation_service import (
    AcceptanceAlreadyDecided,
    AcceptanceNotFound,
    StageAlreadyAccepted,
    request_acceptance_with_effects,
    return_acceptance_with_effects,
)
from app.services.project_access import require_project

router = APIRouter(tags=["work-acceptances"])


class AcceptanceRequestIn(BaseModel):
    stage_id: str
    checklist: list[str] | None = None
    comment: str | None = None


class AcceptanceReturnIn(BaseModel):
    checklist: list[str] | None = None
    quality_score: float | None = Field(default=None, ge=1, le=5)
    comment: str | None = None
    create_issue: bool = True


class PortalAcceptanceReturnIn(AcceptanceReturnIn):
    token: str


def _translate_transition_error(exc: RuntimeError) -> HTTPException:
    if isinstance(exc, AcceptanceNotFound):
        return HTTPException(404, str(exc))
    if isinstance(exc, StageAlreadyAccepted):
        return HTTPException(409, str(exc))
    if isinstance(exc, AcceptanceAlreadyDecided):
        return HTTPException(409, str(exc))
    return HTTPException(409, "acceptance_transition_conflict")


@router.post("/projects/{project_id}/work-acceptances")
async def request_acceptance(
    project_id: str,
    body: AcceptanceRequestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user)
    require_acceptance_requester(user, project)
    try:
        result = await request_acceptance_with_effects(
            db,
            project=project,
            stage_id=body.stage_id,
            requested_by=user.id,
            checklist=body.checklist,
            comment=body.comment,
        )
    except (AcceptanceNotFound, StageAlreadyAccepted) as exc:
        raise _translate_transition_error(exc) from None
    return acceptance_dict(result.acceptance)


@router.post("/projects/{project_id}/work-acceptances/{acceptance_id}/return")
async def return_acceptance(
    project_id: str,
    acceptance_id: str,
    body: AcceptanceReturnIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user)
    require_acceptance_decider(user, project)
    try:
        result = await return_acceptance_with_effects(
            db,
            project=project,
            acceptance_id=acceptance_id,
            returned_by=user.id,
            checklist=body.checklist,
            quality_score=body.quality_score,
            comment=body.comment,
            create_issue=body.create_issue,
            source="app",
        )
    except (AcceptanceNotFound, AcceptanceAlreadyDecided) as exc:
        raise _translate_transition_error(exc) from None
    return acceptance_dict(result.acceptance)


async def _portal_customer(
    db: AsyncSession,
    *,
    claims: dict,
    project_id: str,
) -> tuple[User, Project]:
    user = await db.get(User, claims["user_id"])
    if user is None:
        raise HTTPException(401, "invalid_token_user")
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project_not_found")
    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "acceptance_customer_only")
    return user, project


@router.post("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/return")
async def portal_return_acceptance(
    project_id: str,
    acceptance_id: str,
    body: PortalAcceptanceReturnIn,
    db: AsyncSession = Depends(get_db),
):
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user, project = await _portal_customer(
        db,
        claims=claims,
        project_id=project_id,
    )
    try:
        result = await return_acceptance_with_effects(
            db,
            project=project,
            acceptance_id=acceptance_id,
            returned_by=user.id,
            checklist=body.checklist,
            quality_score=body.quality_score,
            comment=body.comment,
            create_issue=body.create_issue,
            source="portal",
        )
    except (AcceptanceNotFound, AcceptanceAlreadyDecided) as exc:
        raise _translate_transition_error(exc) from None
    return acceptance_dict(result.acceptance)
