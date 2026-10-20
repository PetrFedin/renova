"""Version-bound customer decisions. These do not yet authorize legacy payments."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import client_scope_consent_service as scopes

router = APIRouter(prefix="/projects", tags=["client-consent"])


class ScopeProposalIn(BaseModel):
    expected_updated_at: datetime
    client_request_id: str = Field(min_length=8, max_length=80)
    specialist_id: str = Field(min_length=1, max_length=36)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=24)
    unit_price: Decimal = Field(gt=0)
    amount_cap: Decimal = Field(gt=0)
    inclusions: list[str] = Field(min_length=1, max_length=40)
    exclusions: list[str] = Field(max_length=40)
    deliverables: list[str] = Field(min_length=1, max_length=40)
    payment_milestone: str = Field(min_length=1, max_length=500)
    risks: list[str] = Field(max_length=40)


class ScopeDecisionIn(BaseModel):
    digest: str = Field(min_length=64, max_length=64)
    decision: str
    reason: str | None = Field(default=None, max_length=1000)


def _error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code in {
        "scope_proposal_contractor_required", "scope_decision_customer_required",
    }:
        return HTTPException(403, detail={"code": code})
    if code in {"scope_work_order_not_found", "scope_version_not_found"}:
        return HTTPException(404, detail={"code": code})
    if code in {
        "scope_request_conflict", "scope_work_order_not_pending",
        "scope_stale_work_order", "scope_work_budget_mismatch",
        "scope_specialist_mismatch", "scope_specialist_not_project_member",
        "scope_contractor_cannot_assign_customer", "scope_already_authorized",
        "scope_version_superseded", "scope_decision_final_conflict",
        "scope_digest_mismatch", "scope_snapshot_integrity_failed",
    }:
        return HTTPException(409, detail={
            "code":code,
            "message":"Условия изменились или недостаточно подтверждений. Обновите предложение и проверьте его повторно.",
        })
    return HTTPException(422, detail={"code":code})


@router.post("/{project_id}/work-orders/{work_order_id}/scope-versions")
async def propose_scope(
    project_id: str, work_order_id: str, body: ScopeProposalIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.contractor_id:
        raise HTTPException(403, detail={"code":"scope_proposal_contractor_required"})
    try:
        return await scopes.propose_scope(
            db, project=project, work_order_id=work_order_id, actor=user,
            **body.model_dump(),
        )
    except ValueError as exc:
        raise _error(exc) from exc


@router.get("/{project_id}/scope-versions")
async def list_scope_versions(
    project_id: str,
    work_order_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    return {
        "items": await scopes.list_scope_versions(
            db, project_id=project_id, work_order_id=work_order_id,
        ),
        "financial_allocations_enforced": False,
        "legal_signature_verified": False,
    }


@router.post("/{project_id}/scope-versions/{scope_id}/decision")
async def decide_scope(
    project_id: str, scope_id: str, body: ScopeDecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.id != project.customer_id:
        raise HTTPException(403, detail={"code":"scope_decision_customer_required"})
    try:
        return await scopes.decide_scope(
            db, project=project, scope_version_id=scope_id, actor=user,
            **body.model_dump(),
        )
    except ValueError as exc:
        raise _error(exc) from exc
