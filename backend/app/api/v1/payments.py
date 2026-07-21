"""Платежи: авансы, этапы, материалы."""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import PaymentType, Stage, User, UserRole
from app.schemas.project import PaymentCreate, PaymentOut, YookassaCheckoutIn, YookassaCheckoutOut
from app.services import payment_service as pay_svc

router = APIRouter(prefix="/projects", tags=["payments"])


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
    stage_pays = [p for p in items if p.stage_id == stage_id]
    confirmed = sum(p.amount for p in stage_pays if p.status.value == "confirmed")
    pending = sum(p.amount for p in stage_pays if p.status.value == "pending")
    target = float(stage.payment_amount or 0)
    return {
        "stage_id": stage_id,
        "target": target,
        "confirmed": round(confirmed, 2),
        "pending": round(pending, 2),
        "remaining": round(max(0.0, target - confirmed - pending), 2),
        "percent_confirmed": round((confirmed / target * 100) if target else 0, 1),
    }


@router.get("/{project_id}/payments", response_model=list[PaymentOut])
async def list_payments(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
    from app.models.entities import ContractorProfile, Project

    project = await require_project(db, project_id, user, write=False)
    recipient_name = None
    payment_requisites = None
    phone = None
    if project.contractor_id:
        contractor = await db.get(User, project.contractor_id)
        if contractor:
            recipient_name = contractor.full_name
            phone = contractor.phone
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
        "payment_requisites": payment_requisites,
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

    # W69 #40: частичная оплата этапа по %
    amount = body.amount
    notes = body.notes
    if body.percent is not None:
        if not stage:
            raise HTTPException(422, "percent требует stage_id")
        base = float(stage.payment_amount or 0)
        if base <= 0:
            raise HTTPException(422, detail={"code": "stage_payment_unset", "message": "У этапа не задана сумма оплаты"})
        amount = round(base * float(body.percent) / 100.0, 2)
        tag = f"Частичная оплата {body.percent:g}%"
        notes = f"{tag}. {notes}" if notes else tag
        if not body.title or body.title.strip() == "":
            pass
    if amount is None or amount <= 0:
        raise HTTPException(422, "Укажите amount или percent")

    title = body.title
    if body.percent is not None and stage and (not title or title == "Оплата этапа"):
        title = f"{stage.name}: {body.percent:g}%"

    payment = await pay_svc.create_payment(
        db,
        project_id,
        user.id,
        title,
        amount,
        body.payment_type,
        body.stage_id,
        notes,
    )
    # W56: ручной счёт → notify заказчику (честный «отправлен»)
    if project.customer_id and project.customer_id != user.id:
        from app.services import notification_service as notif
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="payment_pending",
            title=f"Счёт к оплате: {payment.title}",
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget?tab=payments",
            return_to="/(customer)/(tabs)/home",
        )
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
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
        # Distinguish settlement vs acceptance for honest UX
        receipt_id = await pay_svc.receipt_id_for_payment(db, payment_id)
        if not (receipt_id or ack) and existing.status.value == "pending":
            # Accepted stage (or non-stage) but no settlement proof
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

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="PaymentApproved",
        title=f"Оплата: {payment.title}",
        body=str(payment.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    # W143/W56: transfer_ack alone → paid_unverified — не врать «подтверждена».
    status_val = payment.status.value if hasattr(payment.status, "value") else str(payment.status)
    unverified = status_val == "paid_unverified"
    n_type = "payment_pending" if unverified else "payment_confirmed"
    n_title = (
        f"Перевод отмечен (без чека): {payment.title}"
        if unverified
        else f"Оплата подтверждена: {payment.title}"
    )
    for member_id in {project.customer_id, project.contractor_id, project.foreman_id}:
        if not member_id or member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type=n_type,
            title=n_title,
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget" if member_id == project.customer_id else "/(contractor)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home" if member_id == project.customer_id else "/(contractor)/(tabs)/home",
        )
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))

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

    from app.core.config import settings
    from app.services import yookassa_service as yk

    return_url = f"renova://payment-return?projectId={project_id}&paymentId={payment_id}"
    portal_token = (body.portal_token if body else None) or None
    if portal_token:
        from app.services import portal_token_service as portal_tok
        try:
            claims = portal_tok.verify_portal_token(portal_token)
        except ValueError:
            raise HTTPException(401, "invalid_portal_token")
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

    yk_id = pay.get("payment_id")
    if pay.get("demo"):
        if not yk.demo_allowed():
            raise HTTPException(503, "Для staging/production нужны ключи ЮKassa")
        demo_body = {
            "event": "payment.succeeded",
            "object": {
                "id": yk_id or f"demo-{payment_id}",
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
            yookassa_payment_id=yk_id,
            confirmation_url=return_url,
            status="succeeded",
            message="Оплата подтверждена (demo ЮKassa)",
        )

    if yk_id:
        await pay_svc.attach_yookassa_id(db, payment_id, yk_id)

    return YookassaCheckoutOut(
        demo=False,
        payment_id=payment_id,
        yookassa_payment_id=yk_id,
        confirmation_url=pay.get("confirmation_url"),
        status=pay.get("status"),
    )


class EvidenceReviewIn(BaseModel):
    reason: str | None = None
    expected_lock_version: int | None = None


@router.post("/{project_id}/payments/{payment_id}/evidence")
async def submit_payment_evidence(
    project_id: str,
    payment_id: str,
    file: UploadFile = File(...),
    transfer_date: date = Form(...),
    claimed_amount: float = Form(...),
    comment: str | None = Form(None),
    payment_reference: str | None = Form(None),
    client_request_id: str | None = Form(None),
    expected_lock_version: int | None = Form(None),
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заказчик: квитанция ручного перевода → paid_unverified (не confirmed)."""
    from app.services import notification_service as notif
    from app.services import payment_evidence_service as ev_svc

    project = await require_project(db, project_id, user, write=True)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})

    data = await file.read()
    key = (idempotency_key_header or client_request_id or "").strip() or None
    result = await ev_svc.submit_evidence(
        db,
        project=project,
        payment=payment,
        user=user,
        data=data,
        claimed_mime=file.content_type,
        filename=file.filename,
        claimed_amount=claimed_amount,
        transfer_date=transfer_date,
        comment=comment,
        payment_reference=payment_reference,
        idempotency_key=key,
        expected_lock_version=expected_lock_version,
    )

    # refresh payment for response
    payment = await pay_svc.get_payment(db, payment_id)
    if result.get("notified") and not result.get("idempotent_replay") and project.contractor_id:
        await notif.notify(
            db,
            user_id=project.contractor_id,
            project_id=project_id,
            notification_type="payment_pending",
            title=f"Квитанция на проверку: {payment.title}",
            body=str(payment.amount),
            link_path="/(contractor)/(tabs)/budget",
            return_to="/(contractor)/(tabs)/home",
        )
        await db.commit()

    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return {
        "ok": True,
        "idempotent_replay": bool(result.get("idempotent_replay")),
        "replaced": bool(result.get("replaced")),
        "message": "Подтверждение отправлено. Платёж ожидает проверки",
        "payment": pay_svc.payment_dict(payment, receipt_id=receipt_id),
        "evidence": result["evidence"],
    }


@router.get("/{project_id}/payments/{payment_id}/evidence")
async def get_payment_evidence(
    project_id: str,
    payment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import payment_evidence_service as ev_svc

    project = await require_project(db, project_id, user, write=False)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    ev = await ev_svc.get_active_evidence(db, payment_id)
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return {
        "payment": pay_svc.payment_dict(payment, receipt_id=receipt_id),
        "evidence": ev_svc.evidence_dict(ev) if ev else None,
        "can_review": ev_svc.can_review_evidence(user, project),
        "can_submit": ev_svc.can_submit_evidence(user, project, payment),
    }


@router.get("/{project_id}/payments/{payment_id}/evidence/file")
async def download_payment_evidence(
    project_id: str,
    payment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Авторизованное скачивание (bucket не публичный)."""
    from fastapi.responses import Response
    from app.services import payment_evidence_service as ev_svc
    from app.services import storage_service as storage_svc
    from app.models.entities import PaymentEvent, _uuid

    await require_project(db, project_id, user, write=False)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    ev = await ev_svc.get_active_evidence(db, payment_id)
    if not ev:
        raise HTTPException(404, detail={"code": "evidence_not_found", "message": "Файл не найден"})

    data = await storage_svc.read_bytes(ev.storage_key)
    if not data:
        raise HTTPException(404, detail={"code": "evidence_file_missing", "message": "Файл недоступен"})

    db.add(PaymentEvent(
        id=_uuid(),
        payment_id=payment.id,
        actor_user_id=user.id,
        source="manual",
        old_status=payment.status.value,
        new_status=payment.status.value,
        evidence_type="download",
        evidence_ref=ev.id,
        note="evidence_downloaded",
    ))
    await db.commit()

    return Response(
        content=data,
        media_type=ev.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{ev.original_filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{project_id}/payments/{payment_id}/evidence/approve")
async def approve_payment_evidence(
    project_id: str,
    payment_id: str,
    body: EvidenceReviewIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import notification_service as notif
    from app.services import payment_evidence_service as ev_svc

    project = await require_project(db, project_id, user, write=True)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    payment = await ev_svc.approve_evidence(
        db,
        project=project,
        payment=payment,
        user=user,
        expected_lock_version=(body.expected_lock_version if body else None),
    )
    if project.customer_id:
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="payment_confirmed",
            title=f"Оплата подтверждена: {payment.title}",
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home",
        )
        await db.commit()
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return {"ok": True, "payment": pay_svc.payment_dict(payment, receipt_id=receipt_id)}


@router.post("/{project_id}/payments/{payment_id}/evidence/reject")
async def reject_payment_evidence(
    project_id: str,
    payment_id: str,
    body: EvidenceReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import notification_service as notif
    from app.services import payment_evidence_service as ev_svc

    project = await require_project(db, project_id, user, write=True)
    payment = await pay_svc.get_payment(db, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    payment = await ev_svc.reject_evidence(
        db,
        project=project,
        payment=payment,
        user=user,
        reason=body.reason or "",
        expected_lock_version=body.expected_lock_version,
    )
    if project.customer_id:
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="payment_pending",
            title=f"Подтверждение отклонено: {payment.title}",
            body=(body.reason or "")[:200],
            link_path="/(customer)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home",
        )
        await db.commit()
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return {"ok": True, "payment": pay_svc.payment_dict(payment, receipt_id=receipt_id)}
