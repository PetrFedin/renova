"""Canonical work acceptance decisions exposed through magic-link portal tokens."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.work_acceptances import _decision_error, acceptance_dict
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import portal_link_service as portal_links
from app.services import portal_token_service as portal_tokens
from app.services import work_acceptance_decision_service as decisions

router = APIRouter(tags=["portal"])


def _portal_decision_error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code in {"acceptance_already_decided", "acceptance_not_current"}:
        return HTTPException(410, "portal_decision_already_used")
    return _decision_error(exc)


class PortalAcceptanceDecisionIn(BaseModel):
    token: str
    comment: str | None = Field(default=None, max_length=2000)


async def _portal_customer_context(
    db: AsyncSession,
    *,
    token: str,
    project_id: str,
) -> tuple[Project, User]:
    try:
        claims = portal_tokens.verify_portal_token(token)
    except ValueError as exc:
        raise HTTPException(401, "invalid_portal_token") from exc
    # Cross-project portal decisions are deliberately indistinguishable from a missing project.
    if claims.get("project_id") != project_id:
        raise HTTPException(404, "project_not_found")
    if "accept_stage" not in (claims.get("scopes") or []):
        raise HTTPException(403, "portal_read_only")

    # Write-capable portal decisions must be registry-bound. Legacy jti-less tokens remain
    # readable through the portal session for backward compatibility, but cannot mutate
    # acceptance state because they cannot be revoked or scoped by the registry.
    link = await portal_links.get_usable_link(db, claims.get("jti"))
    if link is None:
        raise HTTPException(410, "portal_link_inactive")
    registered_scopes = {scope for scope in (link.scopes or "").split(",") if scope}
    if (
        link.project_id != project_id
        or link.user_id != claims.get("user_id")
        or "accept_stage" not in registered_scopes
    ):
        raise HTTPException(410, "portal_link_inactive")

    user = await db.get(User, claims.get("user_id"))
    if user is None:
        raise HTTPException(401, "user_not_found")
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project_not_found")
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
        raise _portal_decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")
    if result.replayed:
        raise HTTPException(410, "portal_decision_already_used")

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
        raise _portal_decision_error(exc) from exc
    if result is None:
        raise HTTPException(404, "acceptance_not_found")

    if result.replayed:
        raise HTTPException(410, "portal_decision_already_used")

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
