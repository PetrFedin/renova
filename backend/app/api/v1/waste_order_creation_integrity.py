"""Exactly-once WasteOrder draft creation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.api.v1.waste_orders import WasteIn, _out
from app.db.session import get_db
from app.models.entities import User, WasteOrder
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(prefix="/projects", tags=["waste"])
WASTE_ORDER_CREATE_SCOPE = "waste_order.create"


class WasteCreateCommand(WasteIn):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


def _conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос вывоза уже использован с другими данными",
        },
    )


@router.post("/{project_id}/waste-orders")
async def create_waste_order_integrity(
    project_id: str,
    body: WasteCreateCommand,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    payload = body.model_dump(exclude={"client_request_id"}, mode="json")

    try:
        replay_id = await replay_entity_id(
            db,
            scope=WASTE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _conflict() from exc

    if replay_id:
        order = await db.get(WasteOrder, replay_id)
        if not order or order.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _out(order, replayed=True)

    order = WasteOrder(project_id=project_id, **payload)
    db.add(order)
    await db.flush()

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=WASTE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=order.id,
        )
    except IdempotencyConflict as exc:
        raise _conflict() from exc

    if not created:
        canonical = await db.get(WasteOrder, entity_id)
        if not canonical or canonical.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _out(canonical, replayed=True)

    await db.refresh(order)
    return _out(order, replayed=False)
