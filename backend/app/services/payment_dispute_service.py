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


def _normalize_text(value: str, *, short_code: str, long_code: str) -> str:
    normalized = " ".join((value or "").split())
    if len(normalized) < 10:
        raise ValueError(short_code)
    if len(normalized) > 1000:
        raise ValueError(long_code)
    return normalized


def normalize_dispute_reason(reason: str) -> str:
    return _normalize_text(
        reason,
        short_code="payment_dispute_reason_too_short",
        long_code="payment_dispute_reason_too_long",
    )


def normalize_resolution_note(note: str) -> str:
    return _normalize_text(
        note,
        short_code="payment_dispute_resolution_note_too_short",
        long_code="payment_dispute_resolution_note_too_long",
    )


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


async def _latest_event(
    db: AsyncSession,
    *,
    payment_id: str,
    evidence_type: str,
) -> PaymentEvent | None:
    return (
        await db.execute(
            select(PaymentEvent)
            .where(
                PaymentEvent.payment_id == payment_id,
                PaymentEvent.evidence_type == evidence_type,
            )
            .order_by(PaymentEvent.created_at.desc(), PaymentEvent.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _latest_dispute_event(db: AsyncSession, payment_id: str) -> PaymentEvent | None:
    return await _latest_event(
        db,
        payment_id=payment_id,
        evidence_type="customer_dispute",
    )


async def _latest_resolution_event(db: AsyncSession, payment_id: str) -> PaymentEvent | None:
    return await _latest_event(
        db,
        payment_id=payment_id,
        evidence_type="customer_dispute_resolution",
    )


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
    for member_id in {project.contractor_id}:
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


async def _enqueue_resolution_effects(
    db: AsyncSession,
    *,
    payment: Payment,
    project: Project,
    actor_user_id: str,
    note: str,
    target_status: PaymentStatus,
) -> None:
    from app.services import outbox_service as outbox

    status_title = "подтверждена" if target_status == PaymentStatus.confirmed else "отмечена без проверки"
    await outbox.enqueue(
        db,
        aggregate_type="payment",
        aggregate_id=payment.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": payment.project_id,
            "user_id": actor_user_id,
            "kind": "PaymentDisputeResolved",
            "title": f"Спор отозван, оплата {status_title}: {payment.title}",
            "body": note,
            "link_path": "/(customer)/(tabs)/budget?tab=payments",
        },
    )
    for member_id in {project.contractor_id}:
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
                "title": f"Заказчик отозвал спор: {payment.title}",
                "body": note,
                "link_path": "/(contractor)/(tabs)/budget?tab=payments",
                "return_to": "/(contractor)/(tabs)/home",
            },
        )


async def _locked_payment_expenses(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
) -> list[Expense]:
    query = select(Expense).where(
        Expense.project_id == project_id,
        Expense.payment_id == payment_id,
        Expense.status != "deleted",
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return list((await db.execute(query)).scalars().all())


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

    expenses = await _locked_payment_expenses(
        db,
        project_id=project_id,
        payment_id=payment.id,
    )
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


async def resolve_payment_dispute(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
    actor_user_id: str,
    note: str,
) -> PaymentDisputeResult | None:
    normalized_note = normalize_resolution_note(note)
    payment = await _locked_payment(
        db,
        project_id=project_id,
        payment_id=payment_id,
    )
    if not payment:
        return None

    project = await db.get(Project, project_id)
    if not project or project.customer_id != actor_user_id:
        raise ValueError("payment_dispute_customer_required")

    dispute_event = await _latest_dispute_event(db, payment.id)
    resolution_event = await _latest_resolution_event(db, payment.id)

    if payment.status != PaymentStatus.disputed:
        resolution_after_dispute = bool(
            dispute_event
            and resolution_event
            and resolution_event.created_at >= dispute_event.created_at
            and resolution_event.new_status == payment.status.value
        )
        existing_note = " ".join(((resolution_event.note if resolution_event else "") or "").split())
        if resolution_after_dispute and existing_note == normalized_note:
            await db.commit()
            return PaymentDisputeResult(payment=payment, changed=False, replayed=True)
        if resolution_after_dispute:
            raise ValueError("payment_dispute_already_resolved")
        raise ValueError(f"payment_dispute_resolution_blocked:{payment.status.value}")

    if not dispute_event or dispute_event.new_status != PaymentStatus.disputed.value:
        raise ValueError("payment_dispute_evidence_missing")
    try:
        target_status = PaymentStatus(dispute_event.old_status)
    except ValueError as exc:
        raise ValueError("payment_dispute_source_status_invalid") from exc
    if target_status not in {PaymentStatus.confirmed, PaymentStatus.paid_unverified}:
        raise ValueError("payment_dispute_source_status_invalid")

    expenses = await _locked_payment_expenses(
        db,
        project_id=project_id,
        payment_id=payment.id,
    )
    if target_status == PaymentStatus.confirmed:
        if not expenses:
            raise ValueError("payment_dispute_expense_missing")
        for expense in expenses:
            if expense.status != "disputed":
                raise ValueError("payment_dispute_expense_state_conflict")
            expense.status = "confirmed"
    elif expenses:
        raise ValueError("payment_dispute_unverified_expense_conflict")

    payment.status = target_status
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_user_id,
            source="manual",
            old_status=PaymentStatus.disputed.value,
            new_status=target_status.value,
            evidence_type="customer_dispute_resolution",
            evidence_ref=dispute_event.id,
            note=normalized_note,
        )
    )

    from app.services.expense_ledger_service import recalculate_existing_expense_facts

    await db.flush()
    await recalculate_existing_expense_facts(db, project_id)
    await _enqueue_resolution_effects(
        db,
        payment=payment,
        project=project,
        actor_user_id=actor_user_id,
        note=normalized_note,
        target_status=target_status,
    )
    await db.commit()
    await db.refresh(payment)
    return PaymentDisputeResult(payment=payment, changed=True, replayed=False)
