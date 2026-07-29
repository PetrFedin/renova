"""Customer-originated payment dispute state machine."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, PaymentEvent, PaymentStatus, Project, _uuid


@dataclass(frozen=True)
class PaymentDisputeResult:
    payment: Payment
    changed: bool
    replayed: bool


def normalize_dispute_reason(reason: str) -> str:
    normalized = " ".join((reason or "").split())
    if len(normalized) < 10:
        raise ValueError("payment_dispute_reason_too_short")
    if len(normalized) > 1000:
        raise ValueError("payment_dispute_reason_too_long")
    return normalized


async def _locked_payment(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
) -> Payment | None:
    query = select(Payment).where(
        Payment.id == payment_id,
        Payment.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _latest_dispute_event(
    db: AsyncSession,
    payment_id: str,
) -> PaymentEvent | None:
    return (
        await db.execute(
            select(PaymentEvent)
            .where(
                PaymentEvent.payment_id == payment_id,
                PaymentEvent.new_status == PaymentStatus.disputed.value,
                PaymentEvent.evidence_type == "customer_dispute",
            )
            .order_by(PaymentEvent.created_at.desc(), PaymentEvent.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _enqueue_dispute_effects(
    db: AsyncSession,
    *,
    payment: Payment,
    project: Project,
    actor_user_id: str,
    reason: str,
) -> None:
    from app.services import outbox_service as outbox

    await outbox.enqueue(
        db,
        aggregate_type="payment",
        aggregate_id=payment.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": payment.project_id,
            "user_id": actor_user_id,
            "kind": "PaymentDisputed",
            "title": f"Оплата оспорена: {payment.title}",
            "body": reason,
            "link_path": "/(customer)/(tabs)/budget?tab=payments",
        },
    )
    for member_id in {project.contractor_id, project.foreman_id}:
        if not member_id or member_id == actor_user_id:
            continue
        await outbox.enqueue(
            db,
            aggregate_type="payment",
            aggregate_id=payment.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": member_id,
                "project_id": payment.project_id,
                "notification_type": "other",
                "title": f"Заказчик оспорил оплату: {payment.title}",
                "body": reason,
                "link_path": "/(contractor)/(tabs)/budget?tab=payments",
                "return_to": "/(contractor)/(tabs)/home",
            },
        )


async def dispute_payment(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
    actor_user_id: str,
    reason: str,
) -> PaymentDisputeResult | None:
    normalized_reason = normalize_dispute_reason(reason)
    payment = await _locked_payment(
        db,
        project_id=project_id,
        payment_id=payment_id,
    )
    if not payment:
        return None

    if payment.status == PaymentStatus.disputed:
        existing_event = await _latest_dispute_event(db, payment.id)
        existing_reason = " ".join(((existing_event.note if existing_event else "") or "").split())
        if existing_reason == normalized_reason:
            await db.commit()
            return PaymentDisputeResult(payment=payment, changed=False, replayed=True)
        raise ValueError("payment_dispute_already_open")

    if payment.status not in {PaymentStatus.confirmed, PaymentStatus.paid_unverified}:
        raise ValueError(f"payment_dispute_transition_blocked:{payment.status.value}")

    project = await db.get(Project, project_id)
    if not project or project.customer_id != actor_user_id:
        raise ValueError("payment_dispute_customer_required")

    old_status = payment.status.value
    payment.status = PaymentStatus.disputed
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_user_id,
            source="manual",
            old_status=old_status,
            new_status=PaymentStatus.disputed.value,
            evidence_type="customer_dispute",
            evidence_ref=None,
            note=normalized_reason,
        )
    )

    expense_query = select(Expense).where(
        Expense.project_id == project_id,
        Expense.payment_id == payment.id,
        Expense.status != "deleted",
    )
    try:
        expense_query = expense_query.with_for_update()
    except Exception:
        pass
    expenses = list((await db.execute(expense_query)).scalars().all())
    for expense in expenses:
        expense.status = "disputed"

    from app.services.expense_ledger_service import recalculate_existing_expense_facts

    await db.flush()
    await recalculate_existing_expense_facts(db, project_id)
    await _enqueue_dispute_effects(
        db,
        payment=payment,
        project=project,
        actor_user_id=actor_user_id,
        reason=normalized_reason,
    )
    await db.commit()
    await db.refresh(payment)
    return PaymentDisputeResult(payment=payment, changed=True, replayed=False)
