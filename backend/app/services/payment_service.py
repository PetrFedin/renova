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
    *,
    change_order_id: str | None = None,
) -> Payment:
    payment = Payment(
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType(payment_type),
        title=title,
        amount=amount,
        created_by=user_id,
        notes=notes,
        change_order_id=change_order_id,
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
    *,
    request_id: str | None = None,
    scope: str = "payment.create",
) -> Payment:
    """Compatibility entrypoint with the same atomic outbox contract as the API.

    `request_id` makes this idempotent for offline-queued/retried callers (e.g. the
    "invoice from chat" flow — see chat_service.create_payment_message): the same
    request_id + payload replays the original Payment instead of creating a duplicate.
    """
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )

    payload = {
        "title": title,
        "amount": round(float(amount), 2),
        "payment_type": payment_type,
        "stage_id": stage_id,
        "notes": notes,
    }

    replay_id = await replay_entity_id(
        db,
        scope=scope,
        project_id=project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(Payment, replay_id)
        if not existing:
            raise IdempotencyConflict("idempotency_entity_missing")
        return existing

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
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=scope,
            project_id=project_id,
            user_id=user_id,
            request_id=request_id,
            payload=payload,
            entity_id=payment.id,
        )
    except BaseException:
        await db.rollback()
        raise
    if not created:
        existing = await db.get(Payment, entity_id)
        if not existing:
            raise RuntimeError("payment_create_atomic_contract_failed")
        return existing
    if entity_id != payment.id:
        await db.rollback()
        raise RuntimeError("payment_create_atomic_contract_failed")
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

    for member_id in {project.customer_id, project.contractor_id}:
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
                else ("/(customer)/(tabs)/" if customer_link else "/(contractor)/(tabs)/"),
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
    machine_source: str = "webhook",
    reviewed_evidence_id: str | None = None,
    commit: bool = True,
) -> Payment | None:
    """Move a payment once; retries of an achieved state return the same row.

    ``reviewed_evidence_id`` is the only manual-evidence path that may promote
    ``paid_unverified`` to ``confirmed`` without a Receipt. Authorization and
    evidence review state are enforced by the payment-evidence service before
    entering this canonical financial boundary.
    """
    if allow_without_settlement and machine_source not in {"webhook", "reconciliation"}:
        raise ValueError("unsupported_machine_payment_source")
    if reviewed_evidence_id and allow_without_settlement:
        raise ValueError("mixed_payment_evidence_sources")

    payment = await db.get(Payment, payment_id)
    if not payment or (project_id is not None and payment.project_id != project_id):
        return None

    receipt_id = None
    if not allow_without_settlement and not reviewed_evidence_id:
        receipt_id = await settlement_receipt_id(db, payment)

    unverified_only = (
        not allow_without_settlement
        and not reviewed_evidence_id
        and not receipt_id
        and bool(transfer_ack)
    )
    target_status = PaymentStatus.paid_unverified if unverified_only else PaymentStatus.confirmed

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

    if not allow_without_settlement and not (receipt_id or transfer_ack or reviewed_evidence_id):
        return None
    if reviewed_evidence_id and payment.status != PaymentStatus.paid_unverified:
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
                machine_source=machine_source,
                reviewed_evidence_id=reviewed_evidence_id,
                commit=commit,
            )
        return None

    await db.refresh(payment)
    if target_status == PaymentStatus.paid_unverified:
        evidence_type, evidence_ref, source, note = "transfer_ack", None, "manual", "ack_without_receipt"
    elif reviewed_evidence_id:
        evidence_type, evidence_ref, source, note = (
            "payment_evidence",
            reviewed_evidence_id,
            "manual_review",
            "approved_payment_evidence",
        )
    elif allow_without_settlement:
        evidence_type, evidence_ref, source, note = (
            "yookassa",
            payment.yookassa_payment_id,
            machine_source,
            "confirm_payment",
        )
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
        # COM-011: the chat invoice message becomes "confirmed" only on real payment.
        from app.services import chat_service as _chat_svc

        chat_confirmed = await _chat_svc.mark_payment_messages_confirmed(db, payment.id)
    else:
        chat_confirmed = []

    project = await db.get(Project, payment.project_id)
    effects = await _prepare_transition_side_effects(
        db,
        payment=payment,
        project=project,
        unverified=target_status == PaymentStatus.paid_unverified,
        machine_settlement=allow_without_settlement,
    )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(payment)
        activate_client_write_side_effects(effects)
        if chat_confirmed:
            from app.services import chat_service as _chat_svc2

            await _chat_svc2.broadcast_messages_updated(chat_confirmed)
    return payment


async def attach_yookassa_id(
    db: AsyncSession,
    payment_id: str,
    yookassa_id: str,
    *,
    commit: bool = True,
) -> None:
    payment = await db.get(Payment, payment_id)
    if payment:
        payment.yookassa_payment_id = yookassa_id
        if payment.status == PaymentStatus.pending:
            payment.status = PaymentStatus.processing
        await db.flush()
        if commit:
            await db.commit()


async def get_payment(db: AsyncSession, payment_id: str) -> Payment | None:
    return await db.get(Payment, payment_id)


async def receipt_id_for_payment(db: AsyncSession, payment_id: str) -> str | None:
    """Любой чек, приложенный к счёту (для показа в UI). Это ещё не доказательство оплаты."""
    from app.models.entities import Receipt

    result = await db.execute(
        select(Receipt.id)
        .where(Receipt.payment_id == payment_id)
        .order_by(Receipt.created_at.desc(), Receipt.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def receipts_without_fns_check(db: AsyncSession, payment_ids: list[str]) -> set[str]:
    """Счета, к которым приложен чек, но ни один из них не проверен ФНС (BUD-19).

    Такой чек по-прежнему подтверждает счёт (сценарий оплаты не менялся) — UI
    честно подписывает платёж «без проверки ФНС».
    """
    from sqlalchemy import case, func

    from app.models.entities import Receipt

    ids = [pid for pid in payment_ids if pid]
    if not ids:
        return set()
    rows = (
        await db.execute(
            select(Receipt.payment_id, func.max(case((Receipt.fns_verified.is_(True), 1), else_=0)))
            .where(Receipt.payment_id.in_(ids), Receipt.verification_status.not_in(_RECEIPT_REJECTED_STATUSES))
            .group_by(Receipt.payment_id)
        )
    ).all()
    return {pid for pid, any_verified in rows if not any_verified}


async def receipt_unverified_for_payment(db: AsyncSession, payment_id: str) -> bool:
    return payment_id in await receipts_without_fns_check(db, [payment_id])


# Чек подтверждает счёт, только если покрывает его сумму (допуск на округление 1 ₽).
RECEIPT_COVERAGE_TOLERANCE = 1.0
_RECEIPT_REJECTED_STATUSES = ("invalid", "verification_failed")


async def settlement_receipt_id(db: AsyncSession, payment: Payment) -> str | None:
    """Чек, который вправе подтвердить счёт: приложен к счёту и покрывает его сумму.

    Прикладывать чек к счёту может только заказчик-плательщик (проверяется в
    `receipts.py`), поэтому чек исполнителя доказательством оплаты не бывает.
    Чек на меньшую сумму (или забракованный проверкой) счёт не подтверждает —
    остаются перевод «без чека» (`paid_unverified`) и подтверждение получателя.
    """
    from app.models.entities import Receipt

    threshold = round(float(payment.amount or 0), 2) - RECEIPT_COVERAGE_TOLERANCE
    result = await db.execute(
        select(Receipt.id)
        .where(
            Receipt.payment_id == payment.id,
            Receipt.amount >= threshold,
            Receipt.verification_status.not_in(_RECEIPT_REJECTED_STATUSES),
        )
        .order_by(Receipt.fns_verified.desc(), Receipt.created_at.desc(), Receipt.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def receipt_shortfall(db: AsyncSession, payment: Payment) -> float | None:
    """Сумма самого крупного приложенного чека, если он есть, но не покрывает счёт."""
    from sqlalchemy import func

    from app.models.entities import Receipt

    best = (
        await db.execute(
            select(func.max(Receipt.amount)).where(
                Receipt.payment_id == payment.id,
                Receipt.verification_status.not_in(_RECEIPT_REJECTED_STATUSES),
            )
        )
    ).scalar_one_or_none()
    return None if best is None else round(float(best), 2)


async def list_payments(db: AsyncSession, project_id: str) -> list[Payment]:
    result = await db.execute(
        select(Payment)
        .where(Payment.project_id == project_id)
        .order_by(Payment.created_at.desc())
    )
    return list(result.scalars().all())


def payment_dict(payment: Payment, *, receipt_id: str | None = None, receipt_unverified: bool = False) -> dict:
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
        # BUD-19: чек приложен, но ФНС его не проверяла (счёт он при этом подтверждает).
        "receipt_unverified": bool(receipt_id) and receipt_unverified,
    }


# ---------------------------------------------------------------------------
# Жизненный цикл счёта: отмена, правка, лимит по этапу, ответ получателя.
# ---------------------------------------------------------------------------

# Счёт «занимает» сумму этапа, пока он не отменён и не возвращён.
ACTIVE_INVOICE_STATUSES = (
    PaymentStatus.pending,
    PaymentStatus.processing,
    PaymentStatus.paid_unverified,
    PaymentStatus.confirmed,
    PaymentStatus.disputed,
)
INVOICE_TOTAL_TOLERANCE = 0.01


class PaymentRuleError(Exception):
    """Нарушение денежного правила: код и понятный текст для клиента."""

    def __init__(self, code: str, message: str, *, status_code: int = 409, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message, **self.extra}


def _rub(value: float) -> str:
    text = f"{float(value):,.2f}".replace(",", " ").replace(".00", "")
    return f"{text} ₽"


async def stage_invoiced_total(
    db: AsyncSession,
    stage_id: str,
    *,
    exclude_payment_id: str | None = None,
) -> float:
    """Сумма всех активных (не отменённых, не возвращённых) stage-счетов этапа."""
    from sqlalchemy import func

    query = select(func.coalesce(func.sum(Payment.amount), 0.0)).where(
        Payment.stage_id == stage_id,
        Payment.payment_type == PaymentType.stage,
        Payment.status.in_(ACTIVE_INVOICE_STATUSES),
    )
    if exclude_payment_id:
        query = query.where(Payment.id != exclude_payment_id)
    return round(float((await db.execute(query)).scalar_one() or 0.0), 2)


async def assert_stage_capacity(
    db: AsyncSession,
    stage,
    amount: float,
    *,
    exclude_payment_id: str | None = None,
) -> None:
    """Σ активных счетов по этапу не может превышать сумму этапа."""
    limit = round(float(stage.payment_amount or 0), 2)
    if limit <= 0:
        return
    invoiced = await stage_invoiced_total(db, stage.id, exclude_payment_id=exclude_payment_id)
    remaining = round(limit - invoiced, 2)
    if round(float(amount), 2) > remaining + INVOICE_TOTAL_TOLERANCE:
        raise PaymentRuleError(
            "stage_invoice_exceeds_stage_amount",
            (
                f"Сумма счетов по этапу не может быть больше суммы этапа ({_rub(limit)}). "
                f"Уже выставлено {_rub(invoiced)}, можно выставить не более {_rub(max(remaining, 0.0))}."
            ),
            status_code=409,
            extra={"stage_amount": limit, "invoiced": invoiced, "remaining": max(remaining, 0.0)},
        )


async def _has_open_evidence(db: AsyncSession, payment_id: str) -> bool:
    from app.models.payment_evidence import PaymentEvidence

    row = (
        await db.execute(
            select(PaymentEvidence.id)
            .where(
                PaymentEvidence.payment_id == payment_id,
                PaymentEvidence.status.in_(("submitted", "approved")),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


async def _enqueue_party_notice(
    db: AsyncSession,
    *,
    payment: Payment,
    user_id: str | None,
    title: str,
    notification_type: str = "other",
) -> None:
    """Уведомление стороне счёта через outbox (доставит воркер после коммита)."""
    if not user_id:
        return
    from app.services import outbox_service as outbox

    project = await db.get(Project, payment.project_id)
    if not project:
        return
    customer_link = user_id == project.customer_id
    await outbox.enqueue(
        db,
        aggregate_type="payment",
        aggregate_id=payment.id,
        event_type=outbox.PAYMENT_CREATED_EVENT,
        payload={
            "user_id": user_id,
            "project_id": payment.project_id,
            "notification_type": notification_type,
            "title": title,
            "body": str(payment.amount),
            "link_path": "/(customer)/(tabs)/budget?tab=payments"
            if customer_link
            else "/(contractor)/(tabs)/budget?tab=payments",
            "return_to": "/(customer)/(tabs)/" if customer_link else "/(contractor)/(tabs)/",
        },
    )


async def cancel_pending_payment(
    db: AsyncSession,
    payment_id: str,
    *,
    project_id: str,
    actor_id: str,
    actor_is_customer: bool,
    reason: str | None = None,
    commit: bool = True,
) -> Payment | None:
    """Отмена счёта, пока он `pending`: исполнитель отзывает свой счёт, заказчик отклоняет.

    Повтор на уже отменённом счёте возвращает его же (идемпотентно). После оплаты,
    начала ЮKassa-платежа или загрузки подтверждения перевода — 409 с причиной.
    """
    payment = await db.get(Payment, payment_id)
    if not payment or payment.project_id != project_id:
        return None
    if payment.status == PaymentStatus.cancelled:
        return payment
    if payment.status != PaymentStatus.pending:
        raise PaymentRuleError(
            "payment_not_cancellable",
            "Отменить можно только счёт, по которому ещё нет оплаты. "
            "Если деньги уже переведены, используйте подтверждение получения или спор.",
        )
    if await _has_open_evidence(db, payment.id):
        raise PaymentRuleError(
            "payment_has_evidence",
            "К счёту уже приложено подтверждение перевода — отменить его нельзя.",
        )
    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.project_id == project_id,
            Payment.status == PaymentStatus.pending,
        )
        .values(status=PaymentStatus.cancelled)
    )
    if result.rowcount != 1:
        await db.rollback()
        current = await db.get(Payment, payment_id)
        if current and current.status == PaymentStatus.cancelled:
            return current
        raise PaymentRuleError("payment_not_cancellable", "Счёт уже обработан — отменить его нельзя.")

    note = (reason or "").strip()[:255] or None
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_id,
            source="manual",
            old_status=PaymentStatus.pending.value,
            new_status=PaymentStatus.cancelled.value,
            evidence_type="invoice_rejected" if actor_is_customer else "invoice_cancelled",
            note=note,
        )
    )
    await db.refresh(payment)
    project = await db.get(Project, payment.project_id)
    if project:
        if actor_is_customer:
            await _enqueue_party_notice(
                db,
                payment=payment,
                user_id=project.contractor_id,
                title=f"Заказчик отклонил счёт: {payment.title}",
            )
        else:
            await _enqueue_party_notice(
                db,
                payment=payment,
                user_id=project.customer_id,
                title=f"Счёт отозван исполнителем: {payment.title}",
            )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(payment)
    return payment


async def update_pending_payment(
    db: AsyncSession,
    payment_id: str,
    *,
    project_id: str,
    actor_id: str,
    title: str | None = None,
    amount: float | None = None,
    notes: str | None = None,
    notes_supplied: bool = False,
    commit: bool = True,
) -> Payment | None:
    """Исправление счёта исполнителем, пока он `pending`."""
    payment = await db.get(Payment, payment_id)
    if not payment or payment.project_id != project_id:
        return None
    if payment.status != PaymentStatus.pending:
        raise PaymentRuleError(
            "payment_not_editable",
            "Править можно только счёт, по которому ещё нет оплаты.",
        )
    if await _has_open_evidence(db, payment.id):
        raise PaymentRuleError(
            "payment_has_evidence",
            "К счёту уже приложено подтверждение перевода — править его нельзя.",
        )
    old_amount = round(float(payment.amount or 0), 2)
    changed = []
    if amount is not None and round(float(amount), 2) != old_amount:
        if payment.payment_type == PaymentType.stage and payment.stage_id:
            from app.models.entities import Stage

            stage = await db.get(Stage, payment.stage_id)
            if stage:
                await assert_stage_capacity(db, stage, float(amount), exclude_payment_id=payment.id)
        payment.amount = round(float(amount), 2)
        changed.append("amount")
    if title is not None and title.strip() and title.strip() != payment.title:
        payment.title = title.strip()[:255]
        changed.append("title")
    if notes_supplied and (notes or None) != (payment.notes or None):
        payment.notes = notes or None
        changed.append("notes")
    if not changed:
        return payment
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_id,
            source="manual",
            old_status=PaymentStatus.pending.value,
            new_status=PaymentStatus.pending.value,
            evidence_type="invoice_edited",
            note=(
                f"changed={','.join(changed)}"
                + (f"; amount {old_amount:g}->{payment.amount:g}" if "amount" in changed else "")
            )[:255],
        )
    )
    project = await db.get(Project, payment.project_id)
    if project and "amount" in changed:
        await _enqueue_party_notice(
            db,
            payment=payment,
            user_id=project.customer_id,
            title=f"Счёт изменён: {payment.title}",
            notification_type="payment_pending",
        )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(payment)
    return payment


async def resolve_by_recipient(
    db: AsyncSession,
    payment_id: str,
    *,
    project_id: str,
    actor_id: str,
    received: bool,
    note: str | None = None,
    commit: bool = True,
) -> Payment | None:
    """Исполнитель-получатель отвечает по счёту `paid_unverified`.

    `received=True`: деньги пришли -> `confirmed`, расход попадает в факт.
    `received=False`: деньги не пришли -> счёт возвращается в `pending`
    (заказчик видит причину и платит заново или прикладывает чек).
    Повтор того же ответа безопасен.
    """
    payment = await db.get(Payment, payment_id)
    if not payment or payment.project_id != project_id:
        return None
    target = PaymentStatus.confirmed if received else PaymentStatus.pending
    if payment.status == target:
        return payment
    if payment.status != PaymentStatus.paid_unverified:
        raise PaymentRuleError(
            "payment_not_awaiting_recipient",
            "Ответить можно только по счёту, который заказчик отметил как оплаченный без проверки.",
        )
    clean_note = (note or "").strip()[:255] or None
    confirmed_at = utc_now() if received else None
    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.project_id == project_id,
            Payment.status == PaymentStatus.paid_unverified,
        )
        .values(status=target, confirmed_at=confirmed_at)
    )
    if result.rowcount != 1:
        await db.rollback()
        current = await db.get(Payment, payment_id)
        if current and current.status == target:
            return current
        raise PaymentRuleError(
            "payment_not_awaiting_recipient",
            "Счёт уже обработан.",
        )
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_id,
            source="recipient",
            old_status=PaymentStatus.paid_unverified.value,
            new_status=target.value,
            evidence_type="recipient_confirmed" if received else "recipient_denied",
            note=clean_note,
        )
    )
    await db.refresh(payment)
    if received:
        from app.services import budget_service as budget

        await budget.expense_from_payment(db, payment)
        await budget.refresh_budget_facts(db, payment.project_id)
    project = await db.get(Project, payment.project_id)
    if project:
        await _enqueue_party_notice(
            db,
            payment=payment,
            user_id=project.customer_id,
            title=(
                f"Исполнитель подтвердил получение денег: {payment.title}"
                if received
                else f"Исполнитель не получил перевод: {payment.title}"
            ),
            notification_type="payment_confirmed" if received else "payment_pending",
        )
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(payment)
    return payment
