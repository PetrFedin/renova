"""Provider-originated payment cancellation and full-refund integrity."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, PaymentEvent, PaymentStatus, Project, _uuid


@dataclass(frozen=True)
class ReversalResult:
    handled: bool
    changed: bool = False
    payment_id: str | None = None
    reason: str | None = None


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
            "body": str(payment.amount),
            "link_path": "/(customer)/(tabs)/budget?tab=payments",
        },
    )
    for member_id in {project.customer_id, project.contractor_id, project.foreman_id}:
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
                "body": str(payment.amount),
                "link_path": "/(customer)/(tabs)/budget?tab=payments" if customer_link else "/(contractor)/(tabs)/budget?tab=payments",
                "return_to": "/(customer)/(tabs)/home" if customer_link else "/(contractor)/(tabs)/home",
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
) -> ReversalResult:
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
        await db.commit()
        return ReversalResult(handled=True, changed=False, payment_id=payment.id, reason="replay")
    if payment.status not in {PaymentStatus.pending, PaymentStatus.processing}:
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
            source="webhook",
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
    await db.commit()
    return ReversalResult(handled=True, changed=True, payment_id=payment.id)


async def apply_provider_refund(
    db: AsyncSession,
    *,
    yookassa_payment_id: str,
    refund_id: str | None,
    amount: float,
    currency: str,
) -> ReversalResult:
    payment = await _locked_payment_by_provider_id(
        db,
        yookassa_payment_id=yookassa_payment_id,
    )
    if not payment:
        return ReversalResult(handled=False, reason="payment_not_found")
    if currency != "RUB":
        return ReversalResult(handled=False, payment_id=payment.id, reason="currency_mismatch")
    if round(float(payment.amount or 0), 2) != round(float(amount or 0), 2):
        return ReversalResult(handled=False, payment_id=payment.id, reason="partial_refund_unsupported")
    if payment.status == PaymentStatus.refunded:
        await db.commit()
        return ReversalResult(handled=True, changed=False, payment_id=payment.id, reason="replay")
    if payment.status not in {PaymentStatus.confirmed, PaymentStatus.disputed}:
        await db.commit()
        return ReversalResult(handled=True, changed=False, payment_id=payment.id, reason="refund_source_not_confirmed")

    old_status = payment.status.value
    payment.status = PaymentStatus.refunded
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            source="webhook",
            old_status=old_status,
            new_status=PaymentStatus.refunded.value,
            evidence_type="yookassa_refund",
            evidence_ref=refund_id,
            note="refund.succeeded",
        )
    )
    expense = (
        await db.execute(
            select(Expense).where(
                Expense.project_id == payment.project_id,
                Expense.payment_id == payment.id,
                Expense.status != "deleted",
            ).limit(1)
        )
    ).scalar_one_or_none()
    if expense:
        expense.status = "refund"
    await db.flush()

    from app.services.expense_ledger_service import recalculate_existing_expense_facts

    await recalculate_existing_expense_facts(db, payment.project_id)
    await _enqueue_reversal_effects(
        db,
        payment=payment,
        kind="PaymentRefunded",
        title=f"Возврат оплаты ЮKassa: {payment.title}",
    )
    await db.commit()
    return ReversalResult(handled=True, changed=True, payment_id=payment.id)


async def process_provider_reversal(body: dict[str, Any], db: AsyncSession) -> ReversalResult:
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
        )
    if event == "refund.succeeded" and obj.get("status") == "succeeded":
        provider_payment_id = str(obj.get("payment_id") or "")
        if not provider_payment_id:
            return ReversalResult(handled=False, reason="missing_payment_id")
        amount, currency = _money(obj)
        return await apply_provider_refund(
            db,
            yookassa_payment_id=provider_payment_id,
            refund_id=str(obj.get("id") or "") or None,
            amount=amount,
            currency=currency,
        )
    return ReversalResult(handled=False, reason="unsupported_event")
