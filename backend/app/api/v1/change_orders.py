from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import ChangeOrder, Stage, User, UserRole
from app.services import change_order_service as co_svc

router = APIRouter(prefix="/projects/{project_id}/change-orders", tags=["change-orders"])
CHANGE_ORDER_CREATE_SCOPE = "change_order.create"


class ChangeOrderCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    description: str | None = None
    stage_id: str | None = Field(default=None, max_length=36)
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


async def _dispatch_prepared_effects(db: AsyncSession, *, source: str) -> None:
    from app.services.client_write_side_effects import clear_request_side_effect_context
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    clear_request_side_effect_context()
    await dispatch_best_effort(db, source=source, limit=10)


@router.get("")
async def list_co(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items = await co_svc.list_orders(db, project_id)
    payments = await co_svc.payments_by_order(db, project_id)
    return [
        {
            "id": x.id,
            "title": x.title,
            "amount": x.amount,
            "status": x.status.value,
            "description": x.description,
            "stage_id": x.stage_id,
            "payment_id": payments[x.id].id if x.id in payments else None,
            "payment_status": payments[x.id].status.value if x.id in payments else None,
        }
        for x in items
    ]


@router.post("")
async def create_co(project_id: str, body: ChangeOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from app.services import team_service as team_svc

    await team_svc.require_capability(db, user, project, "billing")  # MNY-004

    from app.services.change_order_create_service import prepare_order
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )

    if body.stage_id:
        stage = await db.get(Stage, body.stage_id)
        if not stage or stage.project_id != project_id:
            raise HTTPException(404, "stage_not_found")

    payload = {
        "title": body.title,
        "amount": float(body.amount),
        "description": body.description,
    }
    if body.stage_id:  # ключ только когда задан: старые request_id без этапа хэшируются как раньше
        payload["stage_id"] = body.stage_id
    try:
        replay_id = await replay_entity_id(
            db,
            scope=CHANGE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": "idempotency_conflict",
                "message": "Этот идентификатор запроса уже использован для других доп. работ",
            },
        ) from error

    if replay_id:
        existing = await db.get(ChangeOrder, replay_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return {"id": existing.id, "status": existing.status.value, "replayed": True}

    order = await prepare_order(
        db,
        project_id=project_id,
        user_id=user.id,
        title=body.title,
        amount=body.amount,
        description=body.description,
        stage_id=body.stage_id,
    )
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=CHANGE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=order.id,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": "idempotency_conflict",
                "message": "Этот идентификатор запроса уже использован для других доп. работ",
            },
        ) from error

    if not created:
        existing = await db.get(ChangeOrder, entity_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return {"id": existing.id, "status": existing.status.value, "replayed": True}

    await _dispatch_prepared_effects(db, source="change_order.create")
    return {"id": order.id, "status": order.status.value, "replayed": False}


@router.post("/{order_id}/approve")
async def approve_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    try:
        co, draft_meta = await co_svc.approve_with_sign_draft(
            db,
            project_id=project_id,
            order_id=order_id,
            created_by=user.id,
        )
    except co_svc.ChangeOrderFinalStateConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": co_svc.CHANGE_ORDER_FINAL_STATE_CONFLICT,
                "message": "Доп. работы уже отклонены и не могут быть согласованы",
            },
        ) from error
    if not co:
        raise HTTPException(404)

    # Ответ собираем ДО диспетча outbox: dispatch_best_effort может сделать
    # rollback и протухнуть ORM-объекты (JRN-004), а решение уже закоммичено.
    draft_id = (draft_meta or {}).get("id")
    replayed = bool((draft_meta or {}).get("replayed"))
    response = {
        "ok": True,
        "status": co.status.value,
        "document_id": draft_id,
        "payment_id": (draft_meta or {}).get("payment_id"),
        "payment_status": (draft_meta or {}).get("payment_status"),
        "stage_id": co.stage_id,
        "amount": co.amount,
        "title": co.title,
        "schedule_synced": bool((draft_meta or {}).get("schedule_synced")),
        "replayed": replayed,
    }
    if not replayed:
        await _dispatch_prepared_effects(db, source="change_order.approve")
    return response


@router.post("/{order_id}/reject")
async def reject_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    try:
        co, replayed = await co_svc.reject_with_effects(
            db,
            project_id=project_id,
            order_id=order_id,
            rejected_by=user.id,
        )
    except co_svc.ChangeOrderFinalStateConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": co_svc.CHANGE_ORDER_FINAL_STATE_CONFLICT,
                "message": "Доп. работы уже согласованы и не могут быть отклонены",
            },
        ) from error
    if not co:
        raise HTTPException(404)

    response = {"ok": True, "status": co.status.value, "replayed": replayed}
    if not replayed:
        await _dispatch_prepared_effects(db, source="change_order.reject")
    return response
