from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.project import PaymentOut
from app.services import payment_dispute_service as disputes
from app.services import payment_service as payments

router = APIRouter(prefix="/projects", tags=["payment-disputes"])


class PaymentDisputeIn(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)


class PaymentDisputeOut(BaseModel):
    payment: PaymentOut
    changed: bool
    replayed: bool


def _dispute_http_error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code in {"payment_dispute_reason_too_short", "payment_dispute_reason_too_long"}:
        return HTTPException(422, detail={"code": code})
    if code == "payment_dispute_customer_required":
        return HTTPException(403, detail={"code": code})
    if code == "payment_dispute_already_open":
        return HTTPException(409, detail={"code": code})
    if code.startswith("payment_dispute_transition_blocked:"):
        return HTTPException(409, detail={"code": code})
    return HTTPException(409, detail={"code": "payment_dispute_failed"})


@router.post(
    "/{project_id}/payments/{payment_id}/dispute",
    response_model=PaymentDisputeOut,
)
async def dispute_payment(
    project_id: str,
    payment_id: str,
    body: PaymentDisputeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "payment_dispute_customer_required"})

    try:
        result = await disputes.dispute_payment(
            db,
            project_id=project_id,
            payment_id=payment_id,
            actor_user_id=user.id,
            reason=body.reason,
        )
    except ValueError as exc:
        await db.rollback()
        raise _dispute_http_error(exc) from exc

    if not result:
        raise HTTPException(404, detail={"code": "payment_not_found"})
    receipt_id = await payments.receipt_id_for_payment(db, result.payment.id)
    return PaymentDisputeOut(
        payment=PaymentOut(**payments.payment_dict(result.payment, receipt_id=receipt_id)),
        changed=result.changed,
        replayed=result.replayed,
    )
