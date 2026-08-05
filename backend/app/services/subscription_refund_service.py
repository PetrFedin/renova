"""Exactly-once subscription refunds and deterministic entitlement rebuild."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Payment, SubscriptionStatus
from app.models.subscription_checkout import SubscriptionCheckout, SubscriptionRefund
from app.services.subscription_service import get_sub


class SubscriptionRefundIntegrityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SubscriptionRefundResult:
    handled: bool
    changed: bool
    duplicate: bool = False
    partial: bool = False
    manual_review: bool = False
    checkout_id: str | None = None
    user_id: str | None = None
    refund_id: str | None = None
    cumulative_amount: float = 0.0
    reason: str | None = None


def _amount(value: Decimal | float | str) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise SubscriptionRefundIntegrityError("subscription_refund_amount_invalid") from exc
    if amount <= 0:
        raise SubscriptionRefundIntegrityError("subscription_refund_amount_invalid")
    return amount


async def _locked_checkout_by_provider(
    db: AsyncSession,
    provider_payment_id: str,
) -> SubscriptionCheckout | None:
    query = select(SubscriptionCheckout).where(
        SubscriptionCheckout.provider_payment_id == provider_payment_id
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _existing_refund(
    db: AsyncSession,
    provider_refund_id: str,
) -> SubscriptionRefund | None:
    return (
        await db.execute(
            select(SubscriptionRefund).where(
                SubscriptionRefund.provider_refund_id == provider_refund_id
            )
        )
    ).scalar_one_or_none()


async def _record_review(
    db: AsyncSession,
    *,
    provider_refund_id: str,
    provider_payment_id: str,
    amount: Decimal,
    currency: str,
    reason: str,
    checkout: SubscriptionCheckout | None = None,
) -> SubscriptionRefund:
    row = SubscriptionRefund(
        checkout_id=checkout.id if checkout else None,
        user_id=checkout.user_id if checkout else None,
        provider_refund_id=provider_refund_id,
        provider_payment_id=provider_payment_id,
        amount=float(amount),
        currency=currency,
        status="manual_review",
        entitlement_changed=False,
        reason=reason,
        review_status="open",
        applied_at=utc_now(),
    )
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
        return row
    except IntegrityError:
        existing = await _existing_refund(db, provider_refund_id)
        if existing is None:
            raise
        return existing


async def _cumulative_refunded_amount(
    db: AsyncSession,
    checkout_id: str | None,
    fallback: float,
) -> float:
    if not checkout_id:
        return fallback
    total = await db.scalar(
        select(func.coalesce(func.sum(SubscriptionRefund.amount), 0.0)).where(
            SubscriptionRefund.checkout_id == checkout_id,
            SubscriptionRefund.status.in_({"partial", "applied"}),
        )
    )
    return float(total or fallback)


async def _recompute_entitlement(
    db: AsyncSession,
    *,
    user_id: str,
    target_checkout_id: str,
) -> bool:
    """Rebuild grants from the nearest reliable snapshot before the target.

    A snapshot captures the aggregate entitlement that existed immediately
    before its purchase. Therefore legacy checkout rows that predate the first
    captured snapshot are already represented in that baseline and do not make
    later refunds impossible. If the refunded purchase predates every snapshot,
    the result remains fail-closed for manual review.
    """
    rows = (
        await db.execute(
            select(SubscriptionCheckout)
            .where(
                SubscriptionCheckout.user_id == user_id,
                SubscriptionCheckout.completed_at.is_not(None),
                SubscriptionCheckout.status.in_(
                    {"succeeded", "partially_refunded", "refunded", "refund_review"}
                ),
            )
            .order_by(SubscriptionCheckout.completed_at, SubscriptionCheckout.id)
        )
    ).scalars().all()
    if not rows:
        raise SubscriptionRefundIntegrityError("subscription_entitlement_history_missing")

    target_index = next(
        (index for index, row in enumerate(rows) if row.id == target_checkout_id),
        None,
    )
    if target_index is None:
        raise SubscriptionRefundIntegrityError("subscription_refund_target_missing")

    baseline_index = next(
        (
            index
            for index in range(target_index, -1, -1)
            if rows[index].entitlement_before_status is not None
            and rows[index].entitlement_before_plan is not None
        ),
        None,
    )
    if baseline_index is None:
        raise SubscriptionRefundIntegrityError("subscription_entitlement_snapshot_missing")

    baseline = rows[baseline_index]
    virtual_status = baseline.entitlement_before_status
    virtual_plan = baseline.entitlement_before_plan
    virtual_expiry = baseline.entitlement_before_expires_at

    for checkout in rows[baseline_index:]:
        if checkout.status in {"refunded", "refund_review"}:
            continue
        completed_at = checkout.completed_at
        if completed_at is None:
            continue
        base = virtual_expiry if virtual_expiry and virtual_expiry > completed_at else completed_at
        virtual_expiry = base + timedelta(days=checkout.days)
        virtual_status = SubscriptionStatus.active.value
        virtual_plan = "pro"

    now = utc_now()
    if virtual_status == SubscriptionStatus.active.value and virtual_expiry and virtual_expiry <= now:
        if virtual_plan == "trial":
            virtual_plan = "trial_used"
        else:
            virtual_plan = "free"
        virtual_status = SubscriptionStatus.free.value

    subscription = await get_sub(db, user_id, commit=False, for_update=True)
    before = (subscription.status.value, subscription.plan, subscription.expires_at)
    subscription.status = SubscriptionStatus(virtual_status)
    subscription.plan = virtual_plan
    subscription.expires_at = virtual_expiry
    await db.flush()
    after = (subscription.status.value, subscription.plan, subscription.expires_at)
    return before != after


async def apply_provider_refund(
    db: AsyncSession,
    *,
    provider_refund_id: str,
    provider_payment_id: str,
    amount: Decimal | float | str,
    currency: str,
    commit: bool = True,
) -> SubscriptionRefundResult | None:
    """Apply one provider refund, or return None for a known project payment.

    Partial refunds are accumulated but do not prorate days. Entitlement changes
    only after the purchase is fully refunded, avoiding ambiguous money-to-day
    rounding. Unknown legacy subscription refunds are durably queued for manual
    review instead of poisoning webhook delivery.
    """
    provider_refund_id = provider_refund_id.strip()
    provider_payment_id = provider_payment_id.strip()
    currency = currency.upper().strip()
    if not provider_refund_id:
        raise SubscriptionRefundIntegrityError("subscription_refund_id_missing")
    if not provider_payment_id:
        raise SubscriptionRefundIntegrityError("subscription_refund_payment_id_missing")
    refund_amount = _amount(amount)
    if not currency:
        raise SubscriptionRefundIntegrityError("subscription_refund_currency_missing")

    duplicate = await _existing_refund(db, provider_refund_id)
    if duplicate is not None:
        cumulative = await _cumulative_refunded_amount(
            db,
            duplicate.checkout_id,
            float(duplicate.amount),
        )
        return SubscriptionRefundResult(
            handled=True,
            changed=False,
            duplicate=True,
            partial=duplicate.status == "partial",
            manual_review=duplicate.status == "manual_review",
            checkout_id=duplicate.checkout_id,
            user_id=duplicate.user_id,
            refund_id=duplicate.id,
            cumulative_amount=cumulative,
            reason=duplicate.reason,
        )

    checkout = await _locked_checkout_by_provider(db, provider_payment_id)
    if checkout is None:
        # Preserve project-payment reversal routing. If neither domain owns the
        # provider payment, record a durable review item and acknowledge it.
        project_payment_id = await db.scalar(
            select(Payment.id).where(Payment.yookassa_payment_id == provider_payment_id)
        )
        if project_payment_id:
            return None
        review = await _record_review(
            db,
            provider_refund_id=provider_refund_id,
            provider_payment_id=provider_payment_id,
            amount=refund_amount,
            currency=currency,
            reason="legacy_or_unknown_subscription_payment",
        )
        if commit:
            await db.commit()
        return SubscriptionRefundResult(
            handled=True,
            changed=False,
            manual_review=True,
            refund_id=review.id,
            cumulative_amount=float(refund_amount),
            reason=review.reason,
        )

    if checkout.status not in {"succeeded", "partially_refunded", "refunded", "refund_review"}:
        raise SubscriptionRefundIntegrityError("subscription_refund_source_not_settled")
    if currency != checkout.currency:
        raise SubscriptionRefundIntegrityError("subscription_refund_currency_mismatch")

    existing_total = await db.scalar(
        select(func.coalesce(func.sum(SubscriptionRefund.amount), 0.0)).where(
            SubscriptionRefund.checkout_id == checkout.id,
            SubscriptionRefund.status.in_({"partial", "applied"}),
        )
    )
    cumulative = Decimal(str(existing_total or 0)).quantize(Decimal("0.01")) + refund_amount
    purchase_amount = Decimal(str(checkout.amount)).quantize(Decimal("0.01"))

    if cumulative > purchase_amount:
        review = await _record_review(
            db,
            provider_refund_id=provider_refund_id,
            provider_payment_id=provider_payment_id,
            amount=refund_amount,
            currency=currency,
            reason="subscription_refund_exceeds_purchase",
            checkout=checkout,
        )
        checkout.status = "refund_review"
        checkout.provider_status = "refunded"
        checkout.refunded_amount = float(cumulative)
        checkout.updated_at = utc_now()
        await db.flush()
        if commit:
            await db.commit()
        return SubscriptionRefundResult(
            handled=True,
            changed=False,
            manual_review=True,
            checkout_id=checkout.id,
            user_id=checkout.user_id,
            refund_id=review.id,
            cumulative_amount=float(cumulative),
            reason=review.reason,
        )

    is_full = cumulative == purchase_amount
    ledger = SubscriptionRefund(
        checkout_id=checkout.id,
        user_id=checkout.user_id,
        provider_refund_id=provider_refund_id,
        provider_payment_id=provider_payment_id,
        amount=float(refund_amount),
        currency=currency,
        status="applied" if is_full else "partial",
        entitlement_changed=False,
        applied_at=utc_now(),
    )
    db.add(ledger)
    checkout.refunded_amount = float(cumulative)
    checkout.updated_at = utc_now()

    if not is_full:
        checkout.status = "partially_refunded"
        checkout.provider_status = "partially_refunded"
        await db.flush()
        if commit:
            await db.commit()
            await db.refresh(ledger)
        return SubscriptionRefundResult(
            handled=True,
            changed=False,
            partial=True,
            checkout_id=checkout.id,
            user_id=checkout.user_id,
            refund_id=ledger.id,
            cumulative_amount=float(cumulative),
        )

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
        ledger.status = "manual_review"
        ledger.review_status = "open"
        ledger.reason = exc.code
        checkout.status = "refund_review"
        changed = False
    ledger.entitlement_changed = changed
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(ledger)
    return SubscriptionRefundResult(
        handled=True,
        changed=changed,
        manual_review=ledger.status == "manual_review",
        checkout_id=checkout.id,
        user_id=checkout.user_id,
        refund_id=ledger.id,
        cumulative_amount=float(cumulative),
        reason=ledger.reason,
    )
