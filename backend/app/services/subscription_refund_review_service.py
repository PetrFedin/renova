"""Operational review queue for ambiguous subscription refunds.

The workflow is deliberately narrow: an administrator may dismiss a refund
without changing entitlement, or link it to one settled checkout and let the
same deterministic refund accounting rebuild entitlement. Arbitrary plan or
expiry edits are not supported.
"""
from __future__ import annotations

import json
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Subscription
from app.models.subscription_checkout import (
    SubscriptionCheckout,
    SubscriptionRefund,
    SubscriptionRefundReviewEvent,
)
from app.services.subscription_refund_service import (
    SubscriptionRefundIntegrityError,
    _recompute_entitlement,
)


CLAIM_TTL_MINUTES = 15
DISMISS_ACTIONS = {"dismiss_not_subscription", "dismiss_duplicate"}
RESOLUTION_ACTIONS = DISMISS_ACTIONS | {"link_and_apply"}


class SubscriptionRefundReviewError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _money(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _effective_review_status(row: SubscriptionRefund, now=None) -> str:
    now = now or utc_now()
    if (
        row.review_status == "claimed"
        and row.review_claim_expires_at is not None
        and row.review_claim_expires_at <= now
    ):
        return "open"
    return row.review_status


def review_item_dict(row: SubscriptionRefund, *, now=None) -> dict:
    now = now or utc_now()
    effective = _effective_review_status(row, now)
    return {
        "id": row.id,
        "checkout_id": row.checkout_id,
        "user_id": row.user_id,
        "provider_refund_id": row.provider_refund_id,
        "provider_payment_id": row.provider_payment_id,
        "amount": row.amount,
        "currency": row.currency,
        "status": row.status,
        "reason": row.reason,
        "entitlement_changed": row.entitlement_changed,
        "review_status": row.review_status,
        "effective_review_status": effective,
        "review_owner_id": row.review_owner_id if effective == "claimed" else None,
        "review_claimed_at": row.review_claimed_at if effective == "claimed" else None,
        "review_claim_expires_at": (
            row.review_claim_expires_at if effective == "claimed" else None
        ),
        "review_version": row.review_version,
        "resolution": row.resolution,
        "resolution_note": row.resolution_note,
        "reviewed_by_id": row.reviewed_by_id,
        "reviewed_at": row.reviewed_at,
        "created_at": row.created_at,
        "applied_at": row.applied_at,
    }


async def _locked_refund(
    db: AsyncSession,
    refund_id: str,
) -> SubscriptionRefund | None:
    query = select(SubscriptionRefund).where(SubscriptionRefund.id == refund_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _locked_checkout(
    db: AsyncSession,
    checkout_id: str,
) -> SubscriptionCheckout | None:
    query = select(SubscriptionCheckout).where(SubscriptionCheckout.id == checkout_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _append_event(
    db: AsyncSession,
    *,
    refund_id: str,
    actor_id: str,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    payload: dict | None = None,
) -> None:
    db.add(
        SubscriptionRefundReviewEvent(
            refund_id=refund_id,
            actor_id=actor_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            payload_json=(
                json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
                if payload
                else None
            ),
        )
    )


async def list_reviews(
    db: AsyncSession,
    *,
    status: str = "actionable",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    now = utc_now()
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    query = select(SubscriptionRefund)

    if status == "actionable":
        query = query.where(
            SubscriptionRefund.status == "manual_review",
            or_(
                SubscriptionRefund.review_status == "open",
                (
                    (SubscriptionRefund.review_status == "claimed")
                    & (
                        (SubscriptionRefund.review_claim_expires_at.is_(None))
                        | (SubscriptionRefund.review_claim_expires_at <= now)
                    )
                ),
            ),
        )
    elif status in {"open", "claimed"}:
        query = query.where(
            SubscriptionRefund.status == "manual_review",
            SubscriptionRefund.review_status == status,
        )
    elif status == "resolved":
        query = query.where(SubscriptionRefund.review_status == "resolved")
    elif status == "all":
        query = query.where(SubscriptionRefund.review_status != "not_required")
    else:
        raise SubscriptionRefundReviewError("refund_review_status_invalid")

    count_query = select(func.count()).select_from(query.order_by(None).subquery())
    total = int((await db.scalar(count_query)) or 0)
    rows = (
        await db.execute(
            query.order_by(SubscriptionRefund.created_at, SubscriptionRefund.id)
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return {
        "items": [review_item_dict(row, now=now) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "status": status,
        "generated_at": now,
    }


async def get_review_detail(db: AsyncSession, refund_id: str) -> dict | None:
    row = await db.get(SubscriptionRefund, refund_id)
    if row is None or row.review_status == "not_required":
        return None
    events = (
        await db.execute(
            select(SubscriptionRefundReviewEvent)
            .where(SubscriptionRefundReviewEvent.refund_id == refund_id)
            .order_by(
                SubscriptionRefundReviewEvent.created_at,
                SubscriptionRefundReviewEvent.id,
            )
        )
    ).scalars().all()
    checkout = await db.get(SubscriptionCheckout, row.checkout_id) if row.checkout_id else None
    subscription = None
    if row.user_id:
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == row.user_id)
            )
        ).scalar_one_or_none()
    return {
        **review_item_dict(row),
        "checkout": (
            {
                "id": checkout.id,
                "user_id": checkout.user_id,
                "status": checkout.status,
                "amount": checkout.amount,
                "currency": checkout.currency,
                "days": checkout.days,
                "provider_payment_id": checkout.provider_payment_id,
                "refunded_amount": checkout.refunded_amount,
                "completed_at": checkout.completed_at,
                "entitlement_before_status": checkout.entitlement_before_status,
                "entitlement_before_plan": checkout.entitlement_before_plan,
                "entitlement_before_expires_at": checkout.entitlement_before_expires_at,
                "entitlement_after_expires_at": checkout.entitlement_after_expires_at,
            }
            if checkout
            else None
        ),
        "current_subscription": (
            {
                "status": subscription.status.value,
                "plan": subscription.plan,
                "expires_at": subscription.expires_at,
            }
            if subscription
            else None
        ),
        "events": [
            {
                "id": event.id,
                "actor_id": event.actor_id,
                "event_type": event.event_type,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "payload_json": event.payload_json,
                "created_at": event.created_at,
            }
            for event in events
        ],
    }


async def claim_review(
    db: AsyncSession,
    *,
    refund_id: str,
    actor_id: str,
    expected_version: int,
    commit: bool = True,
) -> dict | None:
    row = await _locked_refund(db, refund_id)
    if row is None:
        return None
    if row.status != "manual_review" or row.review_status in {"not_required", "resolved"}:
        raise SubscriptionRefundReviewError("refund_review_not_actionable")

    now = utc_now()
    active_claim = (
        row.review_status == "claimed"
        and row.review_claim_expires_at is not None
        and row.review_claim_expires_at > now
    )
    if active_claim and row.review_owner_id == actor_id:
        # A lost HTTP response may replay with the old version. Returning the
        # current lease without extending it is deterministic and harmless.
        if expected_version <= row.review_version:
            return {**review_item_dict(row, now=now), "replayed": True}
    if int(expected_version) != int(row.review_version):
        raise SubscriptionRefundReviewError("refund_review_version_conflict")
    if active_claim and row.review_owner_id != actor_id:
        raise SubscriptionRefundReviewError("refund_review_claimed_by_other")

    from_status = _effective_review_status(row, now)
    row.review_status = "claimed"
    row.review_owner_id = actor_id
    row.review_claimed_at = now
    row.review_claim_expires_at = now + timedelta(minutes=CLAIM_TTL_MINUTES)
    row.review_version += 1
    await _append_event(
        db,
        refund_id=row.id,
        actor_id=actor_id,
        event_type="claimed",
        from_status=from_status,
        to_status="claimed",
        payload={"lease_minutes": CLAIM_TTL_MINUTES, "version": row.review_version},
    )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(row)
    return {**review_item_dict(row), "replayed": False}


async def release_review(
    db: AsyncSession,
    *,
    refund_id: str,
    actor_id: str,
    expected_version: int,
    commit: bool = True,
) -> dict | None:
    row = await _locked_refund(db, refund_id)
    if row is None:
        return None
    if row.status != "manual_review" or row.review_status != "claimed":
        raise SubscriptionRefundReviewError("refund_review_not_claimed")
    if row.review_owner_id != actor_id:
        raise SubscriptionRefundReviewError("refund_review_claimed_by_other")
    if int(expected_version) != int(row.review_version):
        raise SubscriptionRefundReviewError("refund_review_version_conflict")

    row.review_status = "open"
    row.review_owner_id = None
    row.review_claimed_at = None
    row.review_claim_expires_at = None
    row.review_version += 1
    await _append_event(
        db,
        refund_id=row.id,
        actor_id=actor_id,
        event_type="released",
        from_status="claimed",
        to_status="open",
        payload={"version": row.review_version},
    )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(row)
    return {**review_item_dict(row), "replayed": False}


async def _link_and_apply(
    db: AsyncSession,
    *,
    row: SubscriptionRefund,
    checkout_id: str,
) -> dict:
    checkout = await _locked_checkout(db, checkout_id)
    if checkout is None:
        raise SubscriptionRefundReviewError("refund_review_checkout_not_found")
    if row.checkout_id is not None and row.checkout_id != checkout.id:
        raise SubscriptionRefundReviewError("refund_review_checkout_conflict")
    if checkout.status not in {
        "succeeded",
        "partially_refunded",
        "refund_review",
    }:
        raise SubscriptionRefundReviewError("refund_review_checkout_not_settled")
    if checkout.currency != row.currency:
        raise SubscriptionRefundReviewError("refund_review_currency_mismatch")
    if checkout.provider_payment_id not in {None, row.provider_payment_id}:
        raise SubscriptionRefundReviewError("refund_review_provider_payment_conflict")

    provider_owner_id = await db.scalar(
        select(SubscriptionCheckout.id)
        .where(
            SubscriptionCheckout.provider_payment_id == row.provider_payment_id,
            SubscriptionCheckout.id != checkout.id,
        )
        .limit(1)
    )
    if provider_owner_id is not None:
        raise SubscriptionRefundReviewError("refund_review_provider_payment_conflict")

    other_total = await db.scalar(
        select(func.coalesce(func.sum(SubscriptionRefund.amount), 0.0)).where(
            SubscriptionRefund.checkout_id == checkout.id,
            SubscriptionRefund.id != row.id,
            SubscriptionRefund.status.in_({"partial", "applied"}),
        )
    )
    cumulative = _money(float(other_total or 0)) + _money(row.amount)
    purchase_amount = _money(checkout.amount)
    if cumulative > purchase_amount:
        raise SubscriptionRefundReviewError("refund_review_exceeds_purchase")

    checkout.provider_payment_id = row.provider_payment_id
    row.checkout_id = checkout.id
    row.user_id = checkout.user_id
    row.applied_at = utc_now()
    checkout.refunded_amount = float(cumulative)
    checkout.updated_at = utc_now()

    if cumulative < purchase_amount:
        row.status = "partial"
        checkout.status = "partially_refunded"
        checkout.provider_status = "partially_refunded"
        return {
            "partial": True,
            "entitlement_changed": False,
            "cumulative_amount": float(cumulative),
            "checkout_id": checkout.id,
            "user_id": checkout.user_id,
        }

    row.status = "applied"
    checkout.status = "refunded"
    checkout.provider_status = "refunded"
    checkout.entitlement_reversed_at = utc_now()
    try:
        changed = await _recompute_entitlement(
            db,
            user_id=checkout.user_id,
            target_checkout_id=checkout.id,
        )
    except SubscriptionRefundIntegrityError as exc:
        raise SubscriptionRefundReviewError(
            f"refund_review_entitlement_rebuild_failed:{exc.code}"
        ) from exc
    row.entitlement_changed = changed
    return {
        "partial": False,
        "entitlement_changed": changed,
        "cumulative_amount": float(cumulative),
        "checkout_id": checkout.id,
        "user_id": checkout.user_id,
    }


def _same_decision(
    row: SubscriptionRefund,
    *,
    action: str,
    note: str,
    checkout_id: str | None,
) -> bool:
    if row.resolution != action or row.resolution_note != note:
        return False
    if action == "link_and_apply":
        return row.checkout_id == checkout_id
    return True


async def resolve_review(
    db: AsyncSession,
    *,
    refund_id: str,
    actor_id: str,
    expected_version: int,
    decision_key: str,
    action: str,
    note: str,
    checkout_id: str | None = None,
    commit: bool = True,
) -> dict | None:
    decision_key = decision_key.strip()
    action = action.strip()
    note = note.strip()
    checkout_id = checkout_id.strip() if checkout_id else None
    if len(decision_key) < 8 or len(decision_key) > 80:
        raise SubscriptionRefundReviewError("refund_review_decision_key_invalid")
    if action not in RESOLUTION_ACTIONS:
        raise SubscriptionRefundReviewError("refund_review_action_invalid")
    if len(note) < 10 or len(note) > 2000:
        raise SubscriptionRefundReviewError("refund_review_note_invalid")
    if action == "link_and_apply" and not checkout_id:
        raise SubscriptionRefundReviewError("refund_review_checkout_id_required")
    if action in DISMISS_ACTIONS and checkout_id:
        raise SubscriptionRefundReviewError("refund_review_checkout_id_forbidden")

    prior = (
        await db.execute(
            select(SubscriptionRefund).where(
                SubscriptionRefund.decision_key == decision_key
            )
        )
    ).scalar_one_or_none()
    if prior is not None:
        if (
            prior.id == refund_id
            and prior.review_status == "resolved"
            and _same_decision(
                prior,
                action=action,
                note=note,
                checkout_id=checkout_id,
            )
        ):
            return {**review_item_dict(prior), "replayed": True}
        if prior.id == refund_id:
            raise SubscriptionRefundReviewError(
                "refund_review_decision_payload_conflict"
            )
        raise SubscriptionRefundReviewError("refund_review_decision_key_conflict")

    row = await _locked_refund(db, refund_id)
    if row is None:
        return None
    if row.review_status == "resolved":
        raise SubscriptionRefundReviewError("refund_review_already_resolved")
    if row.status != "manual_review":
        raise SubscriptionRefundReviewError("refund_review_not_actionable")

    now = utc_now()
    active_claim = (
        row.review_status == "claimed"
        and row.review_owner_id == actor_id
        and row.review_claim_expires_at is not None
        and row.review_claim_expires_at > now
    )
    if not active_claim:
        raise SubscriptionRefundReviewError("refund_review_active_claim_required")
    if int(expected_version) != int(row.review_version):
        raise SubscriptionRefundReviewError("refund_review_version_conflict")

    outcome = {
        "partial": False,
        "entitlement_changed": False,
        "cumulative_amount": row.amount,
        "checkout_id": row.checkout_id,
        "user_id": row.user_id,
    }
    if action in DISMISS_ACTIONS:
        row.status = "dismissed"
    else:
        outcome = await _link_and_apply(db, row=row, checkout_id=checkout_id)

    previous_review_status = row.review_status
    row.review_status = "resolved"
    row.review_owner_id = None
    row.review_claimed_at = None
    row.review_claim_expires_at = None
    row.review_version += 1
    row.resolution = action
    row.resolution_note = note
    row.decision_key = decision_key
    row.reviewed_by_id = actor_id
    row.reviewed_at = now
    await _append_event(
        db,
        refund_id=row.id,
        actor_id=actor_id,
        event_type="resolved",
        from_status=previous_review_status,
        to_status="resolved",
        payload={
            "action": action,
            "decision_key": decision_key,
            "note": note,
            "outcome": outcome,
            "version": row.review_version,
        },
    )
    try:
        await db.flush()
        if commit:
            await db.commit()
            await db.refresh(row)
    except IntegrityError as exc:
        await db.rollback()
        replay = (
            await db.execute(
                select(SubscriptionRefund).where(
                    SubscriptionRefund.decision_key == decision_key
                )
            )
        ).scalar_one_or_none()
        if (
            replay is not None
            and replay.id == refund_id
            and replay.review_status == "resolved"
            and _same_decision(
                replay,
                action=action,
                note=note,
                checkout_id=checkout_id,
            )
        ):
            return {**review_item_dict(replay), "replayed": True}
        raise SubscriptionRefundReviewError(
            "refund_review_decision_key_conflict"
        ) from exc

    return {
        **review_item_dict(row),
        "replayed": False,
        "outcome": outcome,
    }
