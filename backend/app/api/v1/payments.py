"""Платежи: авансы, этапы, материалы."""
from collections.abc import Awaitable, Callable
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import PaymentType, Stage, User, UserRole
from app.schemas.project import PaymentCreate, PaymentOut, YookassaCheckoutIn, YookassaCheckoutOut
from app.services import payment_service as pay_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.client_write_side_effects import clear_request_side_effect_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["payments"])
PAYMENT_CREATE_SCOPE = "payment.create"


async def _attempt_durable_inline_delivery(
    db: AsyncSession,
    *,
    operation: str,
    payment_id: str,
    delivery: Callable[[], Awaitable[object]],
) -> None:
    """Try immediate delivery without lying about an already committed payment.

    Payment mutations enqueue their activity and notification effects in the same
    transaction. Inline delivery is only a latency optimization; the outbox worker
    remains the source of retry truth when an external push or delivery adapter fails.
    """
    try:
        await delivery()
    except Exception:  # noqa: BLE001 - durable outbox owns the retry
        await db.rollback()
        logger.exception(
            "payment inline delivery deferred operation=%s payment_id=%s",
            operation,
            payment_id,
        )
    finally:
        clear_request_side_effect_context()


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


@router.get("/{project_id}/stages/{stage_id}/payment-progress")
async def stage_payment_progress(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W69 #40: сколько уже выставлено/подтверждено по этапу."""
    await require_project(db, project_id, user, write=False)
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    items = await pay_svc.list_payments(db, project_id)
    stage_pays = [payment for payment in items if payment.stage_id == stage_id]

    def _sum(*statuses: str) -> float:
        return sum(payment.amount for payment in stage_pays if payment.status.value in statuses)

    confirmed = _sum("confirmed")
    # Всё, что уже выставлено и ждёт денег или проверки, занимает сумму этапа.
    pending = _sum("pending", "processing", "paid_unverified", "disputed")
    target = float(stage.payment_amount or 0)
    remaining_raw = target - confirmed - pending
    return {
        "stage_id": stage_id,
        "target": target,
        "confirmed": round(confirmed, 2),
        "pending": round(pending, 2),
        "remaining": round(max(0.0, remaining_raw), 2),
        "overbilled": round(max(0.0, -remaining_raw), 2),
        "percent_confirmed": round((confirmed / target * 100) if target else 0, 1),
    }


@router.get("/{project_id}/payments", response_model=list[PaymentOut])
async def list_payments(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    items = await pay_svc.list_payments(db, project_id)
    out = []
    for item in items:
        receipt_id = await pay_svc.receipt_id_for_payment(db, item.id)
        out.append(PaymentOut(**pay_svc.payment_dict(item, receipt_id=receipt_id)))
    return out


@router.get("/{project_id}/payment-requisites")
async def project_payment_requisites(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Реквизиты исполнителя для перевода (без demo-карт в клиенте)."""
    from sqlalchemy import select
    from app.models.entities import ContractorProfile

    from app.services import project_role_policy as role_policy

    project = await require_project(db, project_id, user, write=False)
    recipient_name = None
    payment_requisites = None
    phone = None
    show_private = await role_policy.can_see_contractor_requisites(db, user, project)
    if project.contractor_id:
        contractor = await db.get(User, project.contractor_id)
        if contractor:
            recipient_name = contractor.full_name
            phone = contractor.phone if show_private else None
        profile = (
            await db.execute(
                select(ContractorProfile).where(ContractorProfile.user_id == project.contractor_id)
            )
        ).scalar_one_or_none()
        if profile:
            payment_requisites = profile.payment_requisites
            if profile.company_name:
                recipient_name = profile.company_name
    return {
        "recipient_name": recipient_name,
        "payment_requisites": payment_requisites if show_private else None,
        "phone": phone,
        "has_bank_details": bool((payment_requisites or "").strip()),
    }


@router.post("/{project_id}/payments", response_model=PaymentOut)
async def create_payment(
    project_id: str,
    body: PaymentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.role == UserRole.customer and body.payment_type not in ("advance", "final"):
        raise HTTPException(403, "Заказчик создаёт аванс/финал")
    if user.role == UserRole.contractor and body.payment_type not in ("stage", "material"):
        raise HTTPException(403, "Исполнитель создаёт оплату этапа/материалов")
    if user.role == UserRole.contractor:
        from app.services import team_service as team_svc

        await team_svc.require_capability(db, user, project, "billing")  # MNY-004

    stage = None
    if body.payment_type == PaymentType.stage.value:
        if not body.stage_id:
            raise HTTPException(422, "Для оплаты этапа нужен stage_id")
        stage = await db.get(Stage, body.stage_id)
        if not stage or stage.project_id != project_id:
            raise HTTPException(404, "Этап проекта не найден")
    elif body.stage_id:
        stage = await db.get(Stage, body.stage_id)
        if not stage or stage.project_id != project_id:
            raise HTTPException(404, "Этап проекта не найден")

    amount = body.amount
    notes = body.notes
    if body.percent is not None:
        if not stage:
            raise HTTPException(422, "percent требует stage_id")
        base = float(stage.payment_amount or 0)
        if base <= 0:
            raise HTTPException(
                422,
                detail={"code": "stage_payment_unset", "message": "У этапа не задана сумма оплаты"},
            )
        amount = round(base * float(body.percent) / 100.0, 2)
        tag = f"Частичная оплата {body.percent:g}%"
        notes = f"{tag}. {notes}" if notes else tag
    if amount is None or amount <= 0:
        raise HTTPException(422, "Укажите amount или percent")

    title = body.title
    if body.percent is not None and stage and (not title or title == "Оплата этапа"):
        title = f"{stage.name}: {body.percent:g}%"

    payload = {
        "title": title,
        "amount": round(float(amount), 2),
        "payment_type": body.payment_type,
        "stage_id": body.stage_id,
        "notes": notes,
    }
    try:
        replay_id = await replay_entity_id(
            db,
            scope=PAYMENT_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc

    created = False
    if replay_id:
        payment = await pay_svc.get_payment(db, replay_id)
        if not payment or payment.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    else:
        if stage is not None and body.payment_type == PaymentType.stage.value:
            try:
                await pay_svc.assert_stage_capacity(db, stage, float(amount))
            except pay_svc.PaymentRuleError as error:
                raise HTTPException(error.status_code, detail=error.detail()) from error
        payment = await pay_svc.prepare_payment(
            db,
            project_id,
            user.id,
            title,
            float(amount),
            body.payment_type,
            body.stage_id,
            notes,
        )
        try:
            created, entity_id = await commit_client_write(
                db,
                scope=PAYMENT_CREATE_SCOPE,
                project_id=project_id,
                user_id=user.id,
                request_id=body.client_request_id,
                payload=payload,
                entity_id=payment.id,
            )
        except IdempotencyConflict as exc:
            raise _idempotency_http_error() from exc
        if not created:
            payment = await pay_svc.get_payment(db, entity_id)
            if not payment:
                raise HTTPException(409, detail={"code": "idempotency_target_missing"})

    persisted_payment_id = payment.id
    # Уведомление отправляется только для реально созданного счёта, не для replay.
    if created and project.customer_id and project.customer_id != user.id:
        from app.services import notification_service as notif

        async def deliver_created_notification() -> object:
            return await notif.notify(
                db,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="payment_pending",
                title=f"Счёт к оплате: {payment.title}",
                body=str(payment.amount),
                link_path="/(customer)/(tabs)/budget?tab=payments",
                return_to="/(customer)/(tabs)/",
            )

        await _attempt_durable_inline_delivery(
            db,
            operation="create",
            payment_id=persisted_payment_id,
            delivery=deliver_created_notification,
        )
    else:
        clear_request_side_effect_context()

    payment = await pay_svc.get_payment(db, persisted_payment_id)
    if not payment:
        raise HTTPException(500, detail={"code": "committed_payment_missing"})
    receipt_id = await pay_svc.receipt_id_for_payment(db, persisted_payment_id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))


class ConfirmPaymentIn(BaseModel):
    """Фиксация внешнего перевода (не эквайринг Renova), кроме путей с чеком/ЮKassa."""
    transfer_ack: bool = False


@router.post("/{project_id}/payments/{payment_id}/confirm", response_model=PaymentOut)
async def confirm_payment(
    project_id: str,
    payment_id: str,
    body: ConfirmPaymentIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Подтверждает оплату заказчик")

    existing = await pay_svc.get_payment(db, payment_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")

    ack = bool(body.transfer_ack) if body else False
    payment = await pay_svc.confirm_payment(
        db,
        payment_id,
        project_id=project_id,
        transfer_ack=ack,
    )
    if not payment:
        receipt_id = await pay_svc.receipt_id_for_payment(db, payment_id)
        shortfall = await pay_svc.receipt_shortfall(db, existing)
        stage_accepted = True
        if existing.payment_type == PaymentType.stage and existing.stage_id:
            gate_stage = await db.get(Stage, existing.stage_id)
            stage_accepted = bool(gate_stage and gate_stage.customer_accepted_at)
        if (
            shortfall is not None
            and stage_accepted
            and shortfall < round(float(existing.amount), 2) - pay_svc.RECEIPT_COVERAGE_TOLERANCE
            and not ack
            and existing.status.value == "pending"
        ):
            raise HTTPException(
                409,
                detail={
                    "code": "receipt_amount_below_invoice",
                    "message": (
                        f"Сумма чека ({shortfall:g} ₽) меньше суммы счёта ({float(existing.amount):g} ₽). "
                        "Приложите чек на полную сумму или отметьте перевод без чека."
                    ),
                    "receipt_amount": shortfall,
                    "invoice_amount": float(existing.amount),
                },
            )
        if not (receipt_id or ack) and existing.status.value == "pending":
            settlement_blocked = True
            if existing.payment_type == PaymentType.stage and existing.stage_id:
                stage = await db.get(Stage, existing.stage_id)
                if not stage or not stage.customer_accepted_at:
                    settlement_blocked = False
            if settlement_blocked:
                raise HTTPException(
                    409,
                    "Сначала отметьте перевод или прикрепите чек — подтверждение без расчёта запрещено",
                )
        if existing.payment_type == PaymentType.stage:
            from app.services import activity_service as act
            await act.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="PaymentBlocked",
                title=f"Оплата заблокирована: {existing.title}",
                body=existing.stage_id,
                link_path=f"/stage/{existing.stage_id}",
                stage_id=existing.stage_id,
            )
            raise HTTPException(409, "Сначала примите этап — оплата без приёмки запрещена")
        if existing.status.value != "pending":
            raise HTTPException(409, "Платёж уже обработан")
        raise HTTPException(409, "Платёж нельзя подтвердить")

    from app.services import activity_service as act
    from app.services import notification_service as notif

    persisted_payment_id = payment.id

    async def deliver_transition_side_effects() -> object:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="PaymentApproved",
            title=f"Оплата: {payment.title}",
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget",
        )
        status_val = payment.status.value if hasattr(payment.status, "value") else str(payment.status)
        unverified = status_val == "paid_unverified"
        notification_type = "payment_pending" if unverified else "payment_confirmed"
        notification_title = (
            f"Перевод отмечен (без чека): {payment.title}"
            if unverified
            else f"Оплата подтверждена: {payment.title}"
        )
        for member_id in {project.customer_id, project.contractor_id}:
            if not member_id or member_id == user.id:
                continue
            await notif.notify(
                db,
                user_id=member_id,
                project_id=project_id,
                notification_type=notification_type,
                title=notification_title,
                body=str(payment.amount),
                link_path="/(customer)/(tabs)/budget" if member_id == project.customer_id else "/(contractor)/(tabs)/budget",
                return_to="/(customer)/(tabs)/" if member_id == project.customer_id else "/(contractor)/(tabs)/",
            )
        return None

    await _attempt_durable_inline_delivery(
        db,
        operation="confirm",
        payment_id=persisted_payment_id,
        delivery=deliver_transition_side_effects,
    )

    payment = await pay_svc.get_payment(db, persisted_payment_id)
    if not payment:
        raise HTTPException(500, detail={"code": "committed_payment_missing"})
    receipt_id = await pay_svc.receipt_id_for_payment(db, persisted_payment_id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))


class PaymentCancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class PaymentUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    amount: float | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=2000)


class RecipientResponseIn(BaseModel):
    received: bool
    note: str | None = Field(default=None, max_length=255)


async def _payment_out(db: AsyncSession, payment) -> PaymentOut:
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))


async def _contractor_side_may_manage(db: AsyncSession, user: User, project, payment) -> bool:
    """Исполнитель управляет счётом, который выставил сам, либо ведущий — счетами stage/material."""
    from app.services import project_role_policy as role_policy

    role = await role_policy.project_actor_role(db, user, project)
    if role == role_policy.ROLE_LEAD:
        return payment.created_by == user.id or payment.payment_type.value in ("stage", "material")
    if role in (role_policy.ROLE_FOREMAN, role_policy.ROLE_MEMBER):
        return payment.created_by == user.id
    return False


@router.post("/{project_id}/payments/{payment_id}/cancel", response_model=PaymentOut)
async def cancel_payment(
    project_id: str,
    payment_id: str,
    body: PaymentCancelIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отмена счёта в ожидании оплаты: исполнитель отзывает свой счёт, заказчик отклоняет."""
    from app.services import project_role_policy as role_policy

    project = await require_project(db, project_id, user, write=True)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")
    role = await role_policy.project_actor_role(db, user, project)
    is_customer = role == role_policy.ROLE_CUSTOMER
    if not is_customer and not await _contractor_side_may_manage(db, user, project, payment):
        raise HTTPException(
            403,
            detail={
                "code": "payment_cancel_forbidden",
                "message": "Отменить счёт может заказчик или исполнитель, который его выставил",
            },
        )
    try:
        result = await pay_svc.cancel_pending_payment(
            db,
            payment_id,
            project_id=project_id,
            actor_id=user.id,
            actor_is_customer=is_customer,
            reason=body.reason if body else None,
        )
    except pay_svc.PaymentRuleError as error:
        raise HTTPException(error.status_code, detail=error.detail()) from error
    clear_request_side_effect_context()
    if not result:
        raise HTTPException(404, "Платёж не найден")
    return await _payment_out(db, result)


@router.patch("/{project_id}/payments/{payment_id}", response_model=PaymentOut)
async def update_payment(
    project_id: str,
    payment_id: str,
    body: PaymentUpdateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Исправить счёт (название, сумма, заметка), пока он в ожидании оплаты. Только выставивший исполнитель."""
    project = await require_project(db, project_id, user, write=True)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")
    if not await _contractor_side_may_manage(db, user, project, payment):
        raise HTTPException(
            403,
            detail={
                "code": "payment_edit_forbidden",
                "message": "Исправить счёт может исполнитель, который его выставил",
            },
        )
    fields = body.model_fields_set
    try:
        result = await pay_svc.update_pending_payment(
            db,
            payment_id,
            project_id=project_id,
            actor_id=user.id,
            title=body.title,
            amount=body.amount,
            notes=body.notes,
            notes_supplied="notes" in fields,
        )
    except pay_svc.PaymentRuleError as error:
        raise HTTPException(error.status_code, detail=error.detail()) from error
    clear_request_side_effect_context()
    if not result:
        raise HTTPException(404, "Платёж не найден")
    return await _payment_out(db, result)


@router.post("/{project_id}/payments/{payment_id}/recipient-response", response_model=PaymentOut)
async def recipient_response(
    project_id: str,
    payment_id: str,
    body: RecipientResponseIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Исполнитель-получатель: «деньги получены» (-> confirmed, в факт) или «не получены» (-> pending).

    Работает по счёту `paid_unverified` — отметке заказчика «перевёл» без чека.
    Ведущий исполнитель проекта решает сам, без платформенного админа.
    """
    from app.services import project_role_policy as role_policy

    project = await require_project(db, project_id, user, write=True)
    if await role_policy.project_actor_role(db, user, project) != role_policy.ROLE_LEAD:
        raise HTTPException(
            403,
            detail={
                "code": "recipient_only",
                "message": "Подтвердить получение денег может исполнитель проекта — получатель платежа",
            },
        )
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")
    try:
        result = await pay_svc.resolve_by_recipient(
            db,
            payment_id,
            project_id=project_id,
            actor_id=user.id,
            received=body.received,
            note=body.note,
        )
    except pay_svc.PaymentRuleError as error:
        raise HTTPException(error.status_code, detail=error.detail()) from error
    clear_request_side_effect_context()
    if not result:
        raise HTTPException(404, "Платёж не найден")
    return await _payment_out(db, result)


@router.post("/{project_id}/payments/{payment_id}/yookassa-checkout", response_model=YookassaCheckoutOut)
async def yookassa_checkout(
    project_id: str,
    payment_id: str,
    body: YookassaCheckoutIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заказчик: редирект на ЮKassa; webhook подтверждает оплату."""
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Оплату через ЮKassa инициирует заказчик")

    existing = await pay_svc.get_payment(db, payment_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")
    if existing.status.value != "pending":
        raise HTTPException(409, "Платёж уже обработан")

    if existing.payment_type == PaymentType.stage and existing.stage_id:
        stage = await db.get(Stage, existing.stage_id)
        if not stage or not stage.customer_accepted_at:
            raise HTTPException(409, "Сначала примите этап — оплата без приёмки запрещена")

    from app.services import yookassa_service as yk

    return_url = f"renova://payment-return?projectId={project_id}&paymentId={payment_id}"
    portal_token = (body.portal_token if body else None) or None
    if portal_token:
        from app.services import portal_token_service as portal_tok
        try:
            claims = portal_tok.verify_portal_token(portal_token)
        except ValueError as exc:
            raise HTTPException(401, "invalid_portal_token") from exc
        if claims.get("project_id") != project_id or claims.get("user_id") != user.id:
            raise HTTPException(403, "portal_token_mismatch")
        if "pay" not in (claims.get("scopes") or []):
            raise HTTPException(403, "portal_pay_scope_required")
        return_url = f"{portal_tok.portal_url(portal_token).split('?', 1)[0]}?token={portal_token}&paid=1&paymentId={payment_id}"

    pay = await yk.create_payment(
        existing.amount,
        existing.title,
        return_url,
        user_id=user.id,
        idempotence_key=f"proj-pay-{payment_id}",
        metadata={
            "kind": "project_payment",
            "payment_id": payment_id,
            "project_id": project_id,
            "user_id": user.id,
        },
    )
    if pay.get("error") == "yookassa_not_configured":
        raise HTTPException(503, pay.get("message", "ЮKassa не настроена на сервере"))

    yookassa_id = pay.get("payment_id")
    if pay.get("demo"):
        if not yk.demo_allowed():
            raise HTTPException(503, "Для staging/production нужны ключи ЮKassa")
        demo_body = {
            "event": "payment.succeeded",
            "object": {
                "id": yookassa_id or f"demo-{payment_id}",
                "status": "succeeded",
                "metadata": {
                    "kind": "project_payment",
                    "payment_id": payment_id,
                    "project_id": project_id,
                    "user_id": user.id,
                },
            },
        }
        await yk.process_webhook(demo_body, db)
        await db.commit()
        return YookassaCheckoutOut(
            demo=True,
            payment_id=payment_id,
            yookassa_payment_id=yookassa_id,
            confirmation_url=return_url,
            status="succeeded",
            message="Оплата подтверждена (demo ЮKassa)",
        )

    if yookassa_id:
        await pay_svc.attach_yookassa_id(db, payment_id, yookassa_id)

    return YookassaCheckoutOut(
        demo=False,
        payment_id=payment_id,
        yookassa_payment_id=yookassa_id,
        confirmation_url=pay.get("confirmation_url"),
        status=pay.get("status"),
    )
