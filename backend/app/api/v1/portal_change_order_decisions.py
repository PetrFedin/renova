"""Canonical portal decisions for change orders.

These routes intentionally replace the legacy definitions in ``portal.py``. They
validate the magic-link scope before any database access and keep project
ownership inside the transactional service query.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.portal import _portal_claims, _require_portal_scope
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import change_order_service as co_svc

router = APIRouter(tags=["portal"])


class PortalChangeOrderDecisionIn(BaseModel):
    token: str


async def _require_customer(
    db: AsyncSession,
    *,
    claims: dict,
    project_id: str,
) -> tuple[User, Project]:
    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "invalid_token_user")

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project_not_found")

    if user.id != project.customer_id or user.role != UserRole.customer:
        raise HTTPException(403, "change_order_customer_only")
    return user, project


@router.post("/portal/projects/{project_id}/change-orders/{order_id}/approve")
async def portal_approve_change_order(
    project_id: str,
    order_id: str,
    body: PortalChangeOrderDecisionIn,
    db: AsyncSession = Depends(get_db),
):
    """Approve a change order only with the explicit ``accept_stage`` scope."""
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user, _project = await _require_customer(db, claims=claims, project_id=project_id)

    order, _document = await co_svc.approve_with_sign_draft(
        db,
        project_id=project_id,
        order_id=order_id,
        created_by=user.id,
    )
    if not order:
        raise HTTPException(404, "change_order_not_found")
    return {"id": order.id, "status": order.status.value}


@router.post("/portal/projects/{project_id}/change-orders/{order_id}/reject")
async def portal_reject_change_order(
    project_id: str,
    order_id: str,
    body: PortalChangeOrderDecisionIn,
    db: AsyncSession = Depends(get_db),
):
    """Reject a project-scoped change order with durable side effects."""
    claims = _portal_claims(body.token, project_id)
    _require_portal_scope(claims, "accept_stage")
    user, _project = await _require_customer(db, claims=claims, project_id=project_id)

    order, _replayed = await co_svc.reject_with_effects(
        db,
        project_id=project_id,
        order_id=order_id,
        rejected_by=user.id,
    )
    if not order:
        raise HTTPException(404, "change_order_not_found")
    return {"id": order.id, "status": order.status.value}
