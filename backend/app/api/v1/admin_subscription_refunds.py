"""Fail-closed administrative workflow for ambiguous subscription refunds."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.db.session import get_db
from app.models.entities import User
from app.services import subscription_refund_review_service as reviews


router = APIRouter(
    prefix="/admin/subscription-refunds/reviews",
    tags=["admin-subscription-refunds"],
)


class RefundReviewClaimIn(BaseModel):
    expected_version: int = Field(ge=0)


class RefundReviewResolutionIn(BaseModel):
    expected_version: int = Field(ge=0)
    decision_key: str = Field(min_length=8, max_length=80)
    action: Literal[
        "dismiss_not_subscription",
        "dismiss_duplicate",
        "link_and_apply",
    ]
    note: str = Field(min_length=10, max_length=2000)
    checkout_id: str | None = Field(default=None, min_length=1, max_length=36)


def _review_http_error(exc: reviews.SubscriptionRefundReviewError) -> HTTPException:
    code = exc.code
    if code in {
        "refund_review_status_invalid",
        "refund_review_decision_key_invalid",
        "refund_review_action_invalid",
        "refund_review_note_invalid",
        "refund_review_checkout_id_required",
    }:
        return HTTPException(422, detail={"code": code})
    if code == "refund_review_checkout_not_found":
        return HTTPException(404, detail={"code": code})
    return HTTPException(409, detail={"code": code})


@router.get("")
async def list_subscription_refund_reviews(
    status: str = Query(
        default="actionable",
        pattern="^(actionable|open|claimed|resolved|all)$",
    ),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await reviews.list_reviews(
            db,
            status=status,
            limit=limit,
            offset=offset,
        )
    except reviews.SubscriptionRefundReviewError as exc:
        raise _review_http_error(exc) from exc


@router.get("/{refund_id}")
async def get_subscription_refund_review(
    refund_id: str,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await reviews.get_review_detail(db, refund_id)
    if result is None:
        raise HTTPException(404, detail={"code": "refund_review_not_found"})
    return result


@router.post("/{refund_id}/claim")
async def claim_subscription_refund_review(
    refund_id: str,
    body: RefundReviewClaimIn,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await reviews.claim_review(
            db,
            refund_id=refund_id,
            actor_id=user.id,
            expected_version=body.expected_version,
        )
    except reviews.SubscriptionRefundReviewError as exc:
        await db.rollback()
        raise _review_http_error(exc) from exc
    if result is None:
        raise HTTPException(404, detail={"code": "refund_review_not_found"})
    return result


@router.post("/{refund_id}/resolve")
async def resolve_subscription_refund_review(
    refund_id: str,
    body: RefundReviewResolutionIn,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await reviews.resolve_review(
            db,
            refund_id=refund_id,
            actor_id=user.id,
            expected_version=body.expected_version,
            decision_key=body.decision_key,
            action=body.action,
            note=body.note,
            checkout_id=body.checkout_id,
        )
    except reviews.SubscriptionRefundReviewError as exc:
        await db.rollback()
        raise _review_http_error(exc) from exc
    if result is None:
        raise HTTPException(404, detail={"code": "refund_review_not_found"})
    return result
