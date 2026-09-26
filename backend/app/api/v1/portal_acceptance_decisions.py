"""Canonical work acceptance decisions exposed through magic-link portal tokens."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.work_acceptances import _decision_error, acceptance_dict
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import portal_access
from app.services import portal_token_service as portal_tokens
from app.services import work_acceptance_decision_service as decisions

router = APIRouter(tags=["portal"])


class PortalAcceptanceDecisionIn(BaseModel):
    token: str
    comment: str | None = Field(default=None, max_length=2000)


async def _portal_customer_context(
    db: AsyncSession,
    *,
    token: str,
    project_id: str,
) -> tuple[Project, User]:
    """Authorise the magic link against current state, not only its signature.

    A signed, unexpired token used to be enough here. It is not: the account
    may have been deleted, its sessions revoked, the participant removed from
    the project, or the project trashed, all while the link stays valid for the
    rest of its 7-day TTL.
    """
    access = await portal_access.authorize_portal(
        db,
        token=token,
        project_id=project_id,
        required_scope="accept_stage",
    )
    user = access.user
    project = access.project
    if user.role != UserRole.customer or user.id != project.customer_id:
        raise HTTPException(403, "acceptance_decision_customer_only")
    return project, user


@router.post("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/accept")
async def portal_accept_work(
    project_id: str,
    acceptance_id: str,
    body: PortalAcceptanceDecisionIn,
    db: AsyncSession = Depends(get_db),
):
    """Accept reviewed work through the same locked lifecycle as the authenticated API."""
    project, user = await _portal_customer_context(
        db,
        token=body.token,
        project_id=project_id,
    )
    try:
        result = await decisions.accept_work(
            db,
            project=project,
            acceptance_id=acceptance_id,
            actor=user,
            comment=body.comment,
            quality_score=None,
            create_issue=False,
            checklist=None,
            source_mode="full",
            source="portal",
        )
    except ValueError as exc:
        raise _decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")

    response = acceptance_dict(result.acceptance)
    response.update(
        {
            "replayed": result.replayed,
            "payment_id": result.payment_id,
            "next_stage_id": result.next_stage_id,
        }
    )
    return response


@router.post("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/return")
async def portal_return_work(
    project_id: str,
    acceptance_id: str,
    body: PortalAcceptanceDecisionIn,
    db: AsyncSession = Depends(get_db),
):
    """Return reviewed work with the canonical rework checklist, SLA and issue."""
    project, user = await _portal_customer_context(
        db,
        token=body.token,
        project_id=project_id,
    )
    try:
        result = await decisions.return_work(
            db,
            project=project,
            acceptance_id=acceptance_id,
            actor=user,
            comment=body.comment or "",
            quality_score=None,
            create_issue=True,
        )
    except ValueError as exc:
        raise _decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")

    response = acceptance_dict(result.acceptance)
    response.update(
        {
            "replayed": result.replayed,
            "issue_id": result.issue_id,
            "rework_deadline": (
                result.stage.rework_deadline.isoformat()
                if result.stage.rework_deadline
                else None
            ),
        }
    )
    return response
