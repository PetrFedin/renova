"""Provider-originated payment cancellation and cumulative refund integrity."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, PaymentEvent, PaymentStatus, Project, _uuid
from app.models.project_payment_refund import ProjectPaymentRefund
from app.services.project_refund_ledger import invoice_money, money, refunded_total


@dataclass(frozen=True)
class ReversalResult:
    handled: bool
    changed: bool = False
    payment_id: str | None = None
    reason: str | None = None
    refunded_amount: float | None = None
    remaining_amount: float | None = None


def _money(obj: dict[str, Any]) -> tuple[float, str]:
    amount = obj.get("amount") or {}
    try:
        value = round(float(amount.get("value") or 0), 2)
    except (TypeError, ValueError):
        value = 0.0
    return value, str(amount.get("currency") or "RUB").upper()


async def _locked_payment_by_id(
    db: AsyncSession,
    *,
    payment_id: str,
    project_id: str | None = None,
) -> Payment | None:
    query = select(Payment).where(Payment.id == payment_id)
    if project_id is not None:
        query = query.where(Payment.project_id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _locked_payment_by_provider_id(
    db: AsyncSession,
    *,
    yookassa_payment_id: str,
) -> Payment | None:
    query = select(Payment).where(Payment.yookassa_payment_id == yookassa_payment_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _enqueue_reversal_effects(
    db: AsyncSession,
    *,
    payment: Payment,
    kind: str,
    title: str,
    amount: Decimal | None = None,
) -> None:
    from app.services import outbox_service as outbox

    project = await db.get(Project, payment.project_id)
    if not project:
        return
    await outbox.enqueue(
        db,
        aggregate_type="payment",
        aggregate_id=payment.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": payment.project_id,
            "user_id": project.customer_id,
            "kind": kind,
            "title": title,
            "body": str(amount if amount is not None else payment.amount),
            "link_path": "/(customer)/(tabs)/budget?tab=payments",
        },
    )
    for member_id in {project.customer_id, project.contractor_id}:
        if not member_id:
            continue
        customer_link = member_id == project.customer_id
        await outbox.enqueue(
            db,
            aggregate_type="payment",
            aggregate_id=payment.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": member_id,
                "project_id": payment.project_id,
                "notification_type": "other",
                "title": title,
                "body": str(amount if amount is not None else payment.amount),
                "link_path": "/(customer)/(tabs)/budget?tab=payments" if customer_link else "/(contractor)/(tabs)/budget?tab=payments",
                "return_to": "/(customer)/(tabs)/" if customer_link else "/(contractor)/(tabs)/",
            },
        )


async def apply_provider_cancellation(
    db: AsyncSession,
    *,
    payment_id: str,
    project_id: str,
    provider_id: str | None,
    amount: float,
    currency: str,
    reason: str | None,
    source: str = "webhook",
    commit: bool = True,
) -> ReversalResult:
    if source not in {"webhook", "reconciliation"}:
        raise ValueError("unsupported_provider_cancellation_source")
    payment = await _locked_payment_by_id(db, payment_id=payment_id, project_id=project_id)
    if not payment:
        return ReversalResult(handled=False, reason="payment_not_found")
    if currency != "RUB":
        return ReversalResult(handled=False, payment_id=payment.id, reason="currency_mismatch")
    if round(float(payment.amount or 0), 2) != round(float(amount or 0), 2):
        return ReversalResult(handled=False, payment_id=payment.id, reason="amount_mismatch")
    if payment.yookassa_payment_id and provider_id and payment.yookassa_payment_id != provider_id:
        return ReversalResult(handled=False, payment_id=payment.id, reason="yookassa_id_mismatch")
    if payment.status == PaymentStatus.cancelled:
        if commit:
            await db.commit()
        return ReversalResult(handled=True, changed=False, payment_id=payment.id, reason="replay")
    if payment.status not in {PaymentStatus.pending, PaymentStatus.processing}:
        if commit:
            await db.commit()
        return ReversalResult(handled=True, changed=False, payment_id=payment.id, reason="terminal_state_conflict")

    old_status = payment.status.value
    payment.status = PaymentStatus.cancelled
    if provider_id and not payment.yookassa_payment_id:
        payment.yookassa_payment_id = provider_id
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            source=source,
            old_status=old_status,
            new_status=PaymentStatus.cancelled.value,
            evidence_type="yookassa_cancellation",
            evidence_ref=provider_id,
            note=(reason or "payment.canceled")[:255],
        )
    )
    await db.flush()
    await _enqueue_reversal_effects(
        db,
        payment=payment,
        kind="PaymentCancelled",
        title=f"Оплата отменена ЮKassa: {payment.title}",
    )
    await db.flush()
    if commit:
        await db.commit()
    return ReversalResult(handled=True, changed=True, payment_id=payment.id)


async def apply_provider_refund(
    db: AsyncSession,
    *,
    yookassa_payment_id: str,
    refund_id: str | None,
    amount: float,
    currency: str,
    commit: bool = True,
) -> ReversalResult:
    """Apply precisely one provider refund and project net spend in the same DB transaction.

    PostgreSQL Payment row lock serializes different refund IDs; provider refund
    ID UNIQUE protects duplicate delivery. The original invoice is immutable;
    an Expense is its net amount after all committed refunds. Failed financial
    checks return a non-acknowledgeable reason to the canonical webhook.
    """
    payment = await _locked_payment_by_provider_id(
        db, yookassa_payment_id=yookassa_payment_id,
    )
    if not payment:
        return ReversalResult(handled=False, reason="payment_not_found")
    if not refund_id or not refund_id.strip():
        return ReversalResult(handled=False, payment_id=payment.id, reason="refund_id_missing")
    refund_id = refund_id.strip()
    if currency.upper() != "RUB":
        return ReversalResult(handled=False, payment_id=payment.id, reason="currency_mismatch")
    try:
        delta = money(amount)
        gross = invoice_money(payment.amount)
    except ValueError as exc:
        return ReversalResult(handled=False, payment_id=payment.id, reason=str(exc))

    # Check identity BEFORE rejecting terminal status: a genuine completed retry
    # returns the prior result, but a reused ID with changed payload is a conflict.
    prior = await db.scalar(
        select(ProjectPaymentRefund).where(
            ProjectPaymentRefund.provider_refund_id == refund_id
        )
    )
    previous = await refunded_total(db, payment.id)
    if prior:
        if (
            prior.payment_id != payment.id
            or prior.project_id != payment.project_id
            or prior.provider_payment_id != yookassa_payment_id
            or prior.currency != "RUB"
            or prior.amount != delta
        ):
            return ReversalResult(
                handled=False, payment_id=payment.id, reason="refund_idempotency_conflict"
            )
        if commit:
            await db.commit()
        return ReversalResult(
            handled=True, changed=False, payment_id=payment.id, reason="replay",
            refunded_amount=float(previous), remaining_amount=float(gross - previous),
        )

    if payment.status in {
        PaymentStatus.pending, PaymentStatus.processing, PaymentStatus.paid_unverified,
    }:
        return ReversalResult(
            handled=False, payment_id=payment.id, reason="refund_source_not_confirmed"
        )
    if payment.status not in {PaymentStatus.confirmed, PaymentStatus.disputed}:
        return ReversalResult(
            handled=False, payment_id=payment.id, reason="refund_terminal_state_conflict"
        )

    cumulative = previous + delta
    if cumulative > gross:
        return ReversalResult(
            handled=False, payment_id=payment.id, reason="refund_exceeds_payment"
        )

    # Never fabricate, double count or silently relink the financial source.
    # Full/partial refunds must modify precisely the pre-existing payment Expense.
    expense_rows = list(
        (await db.execute(
            select(Expense).where(
                Expense.project_id == payment.project_id,
                Expense.payment_id == payment.id,
                Expense.status != "deleted",
            ).with_for_update()
        )).scalars().all()
    )
    if len(expense_rows) != 1:
        return ReversalResult(
            handled=False, payment_id=payment.id, reason="refund_expense_inconsistent"
        )
    expense = expense_rows[0]
    expected_status = "disputed" if payment.status == PaymentStatus.disputed else "confirmed"
    expected_before = gross - previous
    if (
        expense.status != expected_status
        or Decimal(str(expense.amount)).quantize(Decimal("0.01")) != expected_before
    ):
        return ReversalResult(
            handled=False, payment_id=payment.id, reason="refund_expense_inconsistent"
        )

    new_net = gross - cumulative
    is_full = new_net == Decimal("0.00")
    old_status = payment.status.value
    db.add(
        ProjectPaymentRefund(
            id=_uuid(), project_id=payment.project_id, payment_id=payment.id,
            provider_payment_id=yookassa_payment_id,
            provider_refund_id=refund_id, amount=delta, currency="RUB",
        )
    )
    expense.amount = float(new_net)
    if is_full:
        payment.status = PaymentStatus.refunded
        expense.status = "refund"

    db.add(
        PaymentEvent(
            id=_uuid(), payment_id=payment.id, source="webhook",
            old_status=old_status, new_status=payment.status.value,
            evidence_type="yookassa_refund" if is_full else "yookassa_refund_partial",
            evidence_ref=refund_id,
            note=f"refund.succeeded; amount={delta:.2f}; total={cumulative:.2f}",
        )
    )
    await db.flush()

    from app.services.expense_ledger_service import recalculate_existing_expense_facts

    await recalculate_existing_expense_facts(db, payment.project_id)
    await _enqueue_reversal_effects(
        db, payment=payment,
        kind="PaymentRefunded" if is_full else "PaymentPartiallyRefunded",
        title=(
            f"Полный возврат ЮKassa: {payment.title}"
            if is_full else f"Частичный возврат ЮKassa: {payment.title}"
        ),
        amount=delta,
    )
    await db.flush()
    if commit:
        await db.commit()
    return ReversalResult(
        handled=True, changed=True, payment_id=payment.id,
        refunded_amount=float(cumulative), remaining_amount=float(new_net),
    )

async def process_provider_reversal(
    body: dict[str, Any],
    db: AsyncSession,
    *,
    commit: bool = True,
) -> ReversalResult:
    event = str(body.get("event") or "")
    obj = body.get("object") or {}
    if event == "payment.canceled" and obj.get("status") == "canceled":
        metadata = obj.get("metadata") or {}
        if metadata.get("kind") != "project_payment":
            return ReversalResult(handled=False, reason="not_project_payment")
        payment_id = str(metadata.get("payment_id") or "")
        project_id = str(metadata.get("project_id") or "")
        if not payment_id or not project_id:
            return ReversalResult(handled=False, reason="missing_metadata")
        amount, currency = _money(obj)
        cancellation = obj.get("cancellation_details") or {}
        return await apply_provider_cancellation(
            db,
            payment_id=payment_id,
            project_id=project_id,
            provider_id=str(obj.get("id") or "") or None,
            amount=amount,
            currency=currency,
            reason=str(cancellation.get("reason") or "payment.canceled"),
            source="webhook",
            commit=commit,
        )
    if event == "refund.succeeded" and obj.get("status") == "succeeded":
        provider_payment_id = str(obj.get("payment_id") or "")
        if not provider_payment_id:
            return ReversalResult(handled=False, reason="missing_payment_id")
        # Provider refund deltas are financial evidence: never silently round
        # an invalid sub-cent amount or assume RUB when currency is absent.
        raw_amount = obj.get("amount")
        if not isinstance(raw_amount, dict):
            return ReversalResult(handled=False, reason="refund_amount_invalid")
        currency = str(raw_amount.get("currency") or "").strip().upper()
        if currency != "RUB":
            return ReversalResult(handled=False, reason="currency_mismatch")
        try:
            amount = money(raw_amount.get("value"))
        except ValueError as exc:
            return ReversalResult(handled=False, reason=str(exc))
        return await apply_provider_refund(
            db,
            yookassa_payment_id=provider_payment_id,
            refund_id=str(obj.get("id") or "") or None,
            amount=amount,
            currency=currency,
            commit=commit,
        )
    return ReversalResult(handled=False, reason="unsupported_event")
