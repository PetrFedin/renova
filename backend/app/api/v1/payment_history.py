from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project import PaymentOut
from app.services import payment_history_service as history
from app.services import payment_service as payments

router = APIRouter(prefix="/projects", tags=["payment-history"])


@router.get("/{project_id}/payments", response_model=list[PaymentOut])
async def list_payments_with_history(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    items = await payments.list_payments(db, project_id)
    payment_ids = [payment.id for payment in items]
    receipt_map = await history.receipt_ids_by_payment(db, payment_ids)
    event_map = await history.events_by_payment(db, payment_ids)
    return [
        PaymentOut(
            **payments.payment_dict(
                payment,
                receipt_id=receipt_map.get(payment.id),
            ),
            events=event_map.get(payment.id, []),
        )
        for payment in items
    ]
