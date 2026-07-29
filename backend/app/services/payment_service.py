"""Платежи: авансы, этапы, закупка материалов."""
from app.core.timeutil import utc_now

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    _uuid,
)
from app.services.client_write_side_effects import (
    PreparedSideEffect,
    activate_client_write_side_effects,
    suppress_payment_transition_side_effects,
)


async def prepare_payment(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str,
    amount: float,
    payment_type: str,
    stage_id: str | None = None,
    notes: str | None = None,
) -> Payment:
    payment = Payment(
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType(payment_type),
        title=title,
        amount=amount,
        created_by=user_id,
        notes=notes,
    )
    db.add(payment)
    await db.flush()
    return payment


async def create_payment(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str,
    amount: float,
    payment_type: str,
    stage_id: str | None = None,
    notes: str | None = None,
) -> Payment:
    payment = await prepare_payment(
        db,
        project_id,
        user_id,
        title,
        amount,
        payment_type,
        stage_id,
        notes,
    )
    await db.commit()
    await db.refresh(payment)
    return payment


async def _prepare_transition_side_effects(
    db: AsyncSession,
    *,
    payment: Payment,
    project: Project | None,
    unverified: bool,
    machine_settlement: bool,
) -> list[PreparedSideEffect]:
    if not project:
        return []
    from app.services import outbox_service as outbox

    actor_user_id = project.customer_id
    activity_title = (
        f"Оплата (ЮKassa): {payment.title}"
        if machine_settlement
        else f"Оплата: {payment.title}"
    )
    activity_row = await outbox.enqueue(
        db,
        aggregate_type="payment",
        aggregate_id=payment.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": payment.project_id,
            "user_id": actor_user_id,
            "kind": "PaymentApproved",
            "title": activity_title,
            "body": str(payment.amount),
            "link_path": "/(customer)/(tabs)/budget",
        },
    )
    effects = [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]

    notification_type = "payment_pending" if unverified else "payment_confirmed"
    if machine_settlement:
        notification_title = f"Оплата через ЮKassa: {payment.title}"
    elif unverified:
        notification_title = f"Перевод отмечен (без чека): {payment.title}"
    else:
        notification_title = f"Оплата подтверждена: {payment.title}"

    for member_id in {project.customer_id, project.contractor_id, project.foreman_id}:
        if not member_id:
            continue
        if not machine_settlement and member_id == actor_user_id:
            continue
        customer_link = member_id == project.customer_id
        notification_row = await outbox.enqueue(
            db,
            aggregate_type="payment",
            aggregate_id=payment.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": member_id,
                "project_id": payment.project_id,
                "notification_type": notification_type,
                "title": notification_title,
                "body": str(payment.amount),
                "link_path": "/(customer)/(tabs)/budget" if customer_link else "/(contractor)/(tabs)/budget",
                "return_to": None
                if machine_settlement
                else ("/(customer)/(tabs)/home" if customer_link else "/(contractor)/(tabs)/home"),
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=notification_row.id,
                match_key=member_id,
            )
        )
    return effects


def _transition_replay(payment: Payment, target_status: PaymentStatus) -> bool:
    if payment.status == PaymentStatus.confirmed:
        return True
    return target_status == PaymentStatus.paid_unverified and payment.status == PaymentStatus.paid_unverified


async def confirm_payment(
    db: AsyncSession,
    payment_id: str,
    *,
    project_id: str | None = None,
    allow_without_acceptance: bool = False,
    transfer_ack: bool = False,
    allow_without_settlement: bool = False,
) -> Payment | None:
    """Move a payment once; retries of an achieved state return the same row."""
    payment = await db.get(Payment, payment_id)
    if not payment or (project_id is not None and payment.project_id != project_id):
        return None

    receipt_id = None
    if not allow_without_settlement:
        receipt_id = await receipt_id_for_payment(db, payment.id)

    unverified_only = (
        not allow_without_settlement
        and not receipt_id
        and bool(transfer_ack)
    )
    target_status = (
        PaymentStatus.paid_unverified
        if unverified_only
        else PaymentStatus.confirmed
    )

    if _transition_replay(payment, target_status):
        suppress_payment_transition_side_effects()
        return payment
    if payment.status in {
        PaymentStatus.cancelled,
        PaymentStatus.disputed,
        PaymentStatus.refunded,
    }:
        return None

    if payment.payment_type == PaymentType.stage and payment.stage_id and not allow_without_acceptance:
        from app.models.entities import Stage

        stage = await db.get(Stage, payment.stage_id)
        if not stage or stage.project_id != payment.project_id or not stage.customer_accepted_at:
            return None

    if not allow_without_settlement and not (receipt_id or transfer_ack):
        return None

    allowed_from = (
        {PaymentStatus.pending, PaymentStatus.processing}
        if target_status == PaymentStatus.paid_unverified
        else {PaymentStatus.pending, PaymentStatus.processing, PaymentStatus.paid_unverified}
    )
    old_status = payment.status.value
    desired_method = payment.payment_method or (
        "yookassa" if allow_without_settlement else "bank_transfer"
    )
    confirmed_at = utc_now() if target_status == PaymentStatus.confirmed else payment.confirmed_at

    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.project_id == payment.project_id,
            Payment.status.in_(allowed_from),
        )
        .values(
            status=target_status,
            payment_method=desired_method,
            confirmed_at=confirmed_at,
        )
    )

    if result.rowcount != 1:
        await db.rollback()
        current = await db.get(Payment, payment_id)
        if current and _transition_replay(current, target_status):
            suppress_payment_transition_side_effects()
            return current
        if (
            current
            and target_status == PaymentStatus.confirmed
            and current.status == PaymentStatus.paid_unverified
        ):
            return await confirm_payment(
                db,
                payment_id,
                project_id=project_id,
                allow_without_acceptance=allow_without_acceptance,
                transfer_ack=transfer_ack,
                allow_without_settlement=allow_without_settlement,
            )
        return None

    await db.refresh(payment)
    if target_status == PaymentStatus.paid_unverified:
        evidence_type, evidence_ref, source, note = "transfer_ack", None, "manual", "ack_without_receipt"
    elif allow_without_settlement:
        evidence_type, evidence_ref, source, note = "yookassa", payment.yookassa_payment_id, "webhook", "confirm_payment"
    else:
        evidence_type, evidence_ref, source, note = "receipt", receipt_id, "manual", "confirm_payment"

    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            source=source,
            old_status=old_status,
            new_status=target_status.value,
            evidence_type=evidence_type,
            evidence_ref=evidence_ref,
            note=note,
        )
    )

    if target_status == PaymentStatus.confirmed:
        from app.services import budget_service as budget

        await budget.expense_from_payment(db, payment)
        await budget.refresh_budget_facts(db, payment.project_id)

    project = await db.get(Project, payment.project_id)
    effects = await _prepare_transition_side_effects(
        db,
        payment=payment,
        project=project,
        unverified=target_status == PaymentStatus.paid_unverified,
        machine_settlement=allow_without_settlement,
    )
    await db.commit()
    await db.refresh(payment)
    activate_client_write_side_effects(effects)
    return payment


async def attach_yookassa_id(db: AsyncSession, payment_id: str, yookassa_id: str) -> None:
    payment = await db.get(Payment, payment_id)
    if payment:
        payment.yookassa_payment_id = yookassa_id
        if payment.status == PaymentStatus.pending:
            payment.status = PaymentStatus.processing
        await db.commit()


async def get_payment(db: AsyncSession, payment_id: str) -> Payment | None:
    return await db.get(Payment, payment_id)


async def receipt_id_for_payment(db: AsyncSession, payment_id: str) -> str | None:
    from app.models.entities import Receipt

    result = await db.execute(select(Receipt.id).where(Receipt.payment_id == payment_id).limit(1))
    return result.scalar_one_or_none()


async def list_payments(db: AsyncSession, project_id: str) -> list[Payment]:
    result = await db.execute(
        select(Payment)
        .where(Payment.project_id == project_id)
        .order_by(Payment.created_at.desc())
    )
    return list(result.scalars().all())


def payment_dict(payment: Payment, *, receipt_id: str | None = None) -> dict:
    return {
        "id": payment.id,
        "title": payment.title,
        "amount": payment.amount,
        "payment_type": payment.payment_type.value,
        "status": payment.status.value,
        "stage_id": payment.stage_id,
        "notes": payment.notes,
        "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
        "created_at": payment.created_at.isoformat(),
        "receipt_id": receipt_id,
    }
