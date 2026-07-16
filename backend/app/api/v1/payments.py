"""Платежи: авансы, этапы, материалы."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import PaymentType, Stage, User, UserRole
from app.schemas.project import PaymentCreate, PaymentOut
from app.services import payment_service as pay_svc

router = APIRouter(prefix="/projects", tags=["payments"])


@router.get("/{project_id}/payments", response_model=list[PaymentOut])
async def list_payments(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items = await pay_svc.list_payments(db, project_id)
    out = []
    for item in items:
        receipt_id = await pay_svc.receipt_id_for_payment(db, item.id)
        out.append(PaymentOut(**pay_svc.payment_dict(item, receipt_id=receipt_id)))
    return out


@router.post("/{project_id}/payments", response_model=PaymentOut)
async def create_payment(
    project_id: str,
    body: PaymentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role == UserRole.customer and body.payment_type not in ("advance", "final"):
        raise HTTPException(403, "Заказчик создаёт аванс/финал")
    if user.role == UserRole.contractor and body.payment_type not in ("stage", "material"):
        raise HTTPException(403, "Исполнитель создаёт оплату этапа/материалов")

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

    payment = await pay_svc.create_payment(
        db,
        project_id,
        user.id,
        body.title,
        body.amount,
        body.payment_type,
        body.stage_id,
        body.notes,
    )
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))


@router.post("/{project_id}/payments/{payment_id}/confirm", response_model=PaymentOut)
async def confirm_payment(
    project_id: str,
    payment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Подтверждает оплату заказчик")

    existing = await pay_svc.get_payment(db, payment_id)
    if not existing or existing.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")

    payment = await pay_svc.confirm_payment(db, payment_id, project_id=project_id)
    if not payment:
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
    for member_id in {project.customer_id, project.contractor_id, project.foreman_id}:
        if not member_id or member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type="payment_pending",
            title=f"Оплата подтверждена: {payment.title}",
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget" if member_id == project.customer_id else "/(contractor)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home" if member_id == project.customer_id else "/(contractor)/(tabs)/home",
        )
    receipt_id = await pay_svc.receipt_id_for_payment(db, payment.id)
    return PaymentOut(**pay_svc.payment_dict(payment, receipt_id=receipt_id))
