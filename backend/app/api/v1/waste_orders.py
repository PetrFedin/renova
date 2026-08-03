from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, WasteOrder, WasteOrderStatus
from app.services import waste_order_service as waste_svc

router = APIRouter(prefix="/projects", tags=["waste"])


class WasteIn(BaseModel):
    room_id: str | None = None
    volume_m3: float = Field(default=1, gt=0)
    waste_type: str = "construction"
    scheduled_date: date | None = None
    price: float = Field(default=0, ge=0)
    notes: str | None = None


def _out(waste_order: WasteOrder, *, replayed: bool | None = None) -> dict:
    status = (
        waste_order.status.value
        if hasattr(waste_order.status, "value")
        else str(waste_order.status)
    )
    result = {
        "id": waste_order.id,
        "room_id": waste_order.room_id,
        "volume_m3": waste_order.volume_m3,
        "waste_type": waste_order.waste_type,
        "scheduled_date": (
            waste_order.scheduled_date.isoformat()
            if waste_order.scheduled_date
            else None
        ),
        "status": status,
        "price": waste_order.price,
        "notes": waste_order.notes,
        "total": (
            round(waste_order.volume_m3 * waste_order.price, 2)
            if waste_order.price
            else 0
        ),
    }
    if replayed is not None:
        result["replayed"] = replayed
    return result


@router.get("/{project_id}/waste-orders")
async def list_waste(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    result = await db.execute(
        select(WasteOrder)
        .where(WasteOrder.project_id == project_id)
        .order_by(WasteOrder.created_at.desc())
    )
    return [_out(order) for order in result.scalars().all()]


@router.post("/{project_id}/waste-orders")
async def create_waste(
    project_id: str,
    body: WasteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    order = WasteOrder(project_id=project_id, **body.model_dump())
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return _out(order)


async def _transition(
    *,
    project_id: str,
    order_id: str,
    target: WasteOrderStatus,
    user: User,
    db: AsyncSession,
) -> dict:
    project = await require_project(db, project_id, user, write=True)
    try:
        order, replayed = await waste_svc.transition_order(
            db,
            project=project,
            order_id=order_id,
            actor=user,
            target=target,
        )
    except ValueError as error:
        code = str(error)
        if code == "waste_order_actor_forbidden":
            raise HTTPException(
                403,
                detail={
                    "code": code,
                    "message": "Этот переход недоступен для вашей роли.",
                },
            ) from error
        if code.startswith("invalid_waste_order_transition:"):
            raise HTTPException(
                409,
                detail={
                    "code": "invalid_waste_order_transition",
                    "message": "Статус заявки уже изменился или переход недоступен.",
                    "transition": code.split(":", 1)[1],
                },
            ) from error
        raise
    if not order:
        raise HTTPException(404, "waste_order_not_found")
    return _out(order, replayed=replayed)


@router.post("/{project_id}/waste-orders/{order_id}/request")
async def request_waste(
    project_id: str,
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        order_id=order_id,
        target=WasteOrderStatus.requested,
        user=user,
        db=db,
    )


@router.post("/{project_id}/waste-orders/{order_id}/approve")
async def approve_waste(
    project_id: str,
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        order_id=order_id,
        target=WasteOrderStatus.scheduled,
        user=user,
        db=db,
    )


@router.post("/{project_id}/waste-orders/{order_id}/reject")
async def reject_waste(
    project_id: str,
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        order_id=order_id,
        target=WasteOrderStatus.cancelled,
        user=user,
        db=db,
    )


@router.post("/{project_id}/waste-orders/{order_id}/complete")
async def complete_waste(
    project_id: str,
    order_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _transition(
        project_id=project_id,
        order_id=order_id,
        target=WasteOrderStatus.done,
        user=user,
        db=db,
    )
