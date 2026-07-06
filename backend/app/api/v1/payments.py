"""Платежи: авансы, этапы, материалы."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.project import PaymentCreate, PaymentOut
from app.services import payment_service as pay_svc
from app.services import project_service as proj_svc

router = APIRouter(prefix="/projects", tags=["payments"])


@router.get("/{project_id}/payments", response_model=list[PaymentOut])
async def list_payments(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    items = await pay_svc.list_payments(db, project_id)
    return [PaymentOut(**pay_svc.payment_dict(x)) for x in items]


@router.post("/{project_id}/payments", response_model=PaymentOut)
async def create_payment(
    project_id: str,
    body: PaymentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await require_project(db, project_id, user, write=True)
    if user.role == UserRole.customer and body.payment_type not in ("advance", "final"):
        raise HTTPException(403, "Заказчик создаёт аванс/финал")
    if user.role == UserRole.contractor and body.payment_type not in ("stage", "material"):
        raise HTTPException(403, "Исполнитель создаёт оплату этапа/материалов")
    pay = await pay_svc.create_payment(
        db, project_id, user.id, body.title, body.amount, body.payment_type, body.stage_id, body.notes
    )
    return PaymentOut(**pay_svc.payment_dict(pay))


@router.post("/{project_id}/payments/{payment_id}/confirm", response_model=PaymentOut)
async def confirm_payment(
    project_id: str,
    payment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Подтверждает оплату заказчик")
    pay = await pay_svc.confirm_payment(db, payment_id)
    if not pay:
        pending = await pay_svc.get_payment(db, payment_id)
        if pending and pending.project_id == project_id and pending.payment_type.value == "stage":
            from app.services import activity_service as act
            await act.log_event(db, project_id=project_id, user_id=user.id, kind="PaymentBlocked", title=f"Оплата заблокирована: {pending.title}", body=pending.stage_id, link_path=f"/stage/{pending.stage_id}", stage_id=pending.stage_id)
            raise HTTPException(409, "Сначала примите этап — оплата без приёмки запрещена")
        raise HTTPException(404, "Платёж не найден")
    if pay.project_id != project_id:
        raise HTTPException(404, "Платёж не найден")
    from app.services import activity_service as act
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="PaymentApproved", title=f"Оплата: {pay.title}", body=str(pay.amount), link_path="/(customer)/(tabs)/budget")
    return PaymentOut(**pay_svc.payment_dict(pay))
