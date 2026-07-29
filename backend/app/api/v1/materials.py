from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import MaterialPick, MaterialPickStatus, Project, User, UserRole
from app.services import activity_service as act
from app.services import material_pick_service as pick_svc
from app.services import notification_service as notif

router = APIRouter(prefix="/projects", tags=["materials"])
MATERIAL_PICK_CREATE_SCOPE = "material_pick.create"
MATERIAL_PICK_ANALOG_SCOPE = "material_pick.analog"


class PickIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    room_id: str | None = None
    qty: float = Field(default=1, gt=0)
    unit: str = Field(default="шт", min_length=1, max_length=16)
    price: float = Field(default=0, ge=0)
    shop_url: str | None = Field(default=None, max_length=512)
    shop_name: str | None = Field(default=None, max_length=64)
    work_type: str | None = Field(default=None, max_length=64)
    analog_of_id: str | None = None
    notes: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class RejectPickIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


def _out(pick: MaterialPick) -> dict:
    return {
        "id": pick.id,
        "name": pick.name,
        "room_id": pick.room_id,
        "qty": pick.qty,
        "unit": pick.unit,
        "price": pick.price,
        "shop_url": pick.shop_url,
        "shop_name": pick.shop_name,
        "work_type": pick.work_type,
        "status": pick.status.value,
        "analog_of_id": pick.analog_of_id,
        "notes": pick.notes,
        "total": round(pick.qty * pick.price, 2),
    }


def _payload(body: PickIn, *, analog_of_id: str | None = None) -> dict:
    return {
        "name": body.name.strip(),
        "room_id": body.room_id,
        "qty": float(body.qty),
        "unit": body.unit.strip(),
        "price": float(body.price),
        "shop_url": (body.shop_url or "").strip() or None,
        "shop_name": (body.shop_name or "").strip() or None,
        "work_type": (body.work_type or "").strip() or None,
        "analog_of_id": analog_of_id if analog_of_id is not None else body.analog_of_id,
        "notes": (body.notes or "").strip() or None,
    }


def _transition_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "material_pick_transition_terminal": "Закупленный материал нельзя вернуть в согласование",
        "material_pick_transition_invalid": "Недопустимый переход статуса материала",
        "material_pick_locked_by_purchase": "Материал уже включён в активную закупку",
        "material_pick_not_editable": "Изменять можно только черновик материала",
        "material_pick_room_not_found": "Комната не найдена в этом проекте",
        "material_pick_analog_not_found": "Исходный материал не найден в этом проекте",
    }
    return HTTPException(
        409 if code not in {"material_pick_room_not_found", "material_pick_analog_not_found"} else 422,
        detail={"code": code, "message": messages.get(code, "Операция с материалом недоступна")},
    )


async def _deliver_transition(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    pick: MaterialPick,
    event: pick_svc.MaterialPickEvent,
) -> None:
    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind=event.kind,
            title=event.title,
            body=event.body,
            room_id=pick.room_id,
            work_type=pick.work_type,
            link_path="/(customer)/(tabs)/repair?tab=materials",
        )
        if event.recipient_id and event.notification_title:
            await notif.notify(
                db,
                user_id=event.recipient_id,
                project_id=project_id,
                notification_type="approval",
                title=event.notification_title,
                body=event.notification_body or pick.name,
                link_path=event.notification_link,
                return_to="/(customer)/(tabs)/home",
            )
    finally:
        clear_request_side_effect_context()


async def _create_pick(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    body: PickIn,
    scope: str,
    analog_of_id: str | None = None,
) -> tuple[MaterialPick, bool]:
    from app.services import outbox_service as outbox
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )
    from app.services.client_write_side_effects import (
        PreparedSideEffect,
        activate_client_write_side_effects,
        clear_request_side_effect_context,
    )

    payload = _payload(body, analog_of_id=analog_of_id)
    try:
        replay_id = await replay_entity_id(
            db,
            scope=scope,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={"code": "idempotency_conflict", "message": "Идентификатор уже использован для другого материала"},
        ) from error
    if replay_id:
        existing = await pick_svc.get_pick(db, project_id=project_id, pick_id=replay_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return existing, True

    try:
        pick = await pick_svc.prepare_pick(db, project_id=project_id, **payload)
    except ValueError as error:
        raise _transition_error(error) from error

    title = f"Аналог: {pick.name}" if analog_of_id else f"Материал: {pick.name}"
    activity_row = await outbox.enqueue(
        db,
        aggregate_type="material_pick",
        aggregate_id=pick.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project_id,
            "user_id": user.id,
            "kind": "material",
            "title": title,
            "body": pick.shop_url,
            "room_id": pick.room_id,
            "work_type": pick.work_type,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=scope,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=pick.id,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={"code": "idempotency_conflict", "message": "Идентификатор уже использован для другого материала"},
        ) from error
    if not created:
        existing = await pick_svc.get_pick(db, project_id=project_id, pick_id=entity_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return existing, True

    activate_client_write_side_effects(
        [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]
    )
    try:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="material",
            title=title,
            body=pick.shop_url,
            room_id=pick.room_id,
            work_type=pick.work_type,
            link_path="/(customer)/(tabs)/repair?tab=materials",
        )
    finally:
        clear_request_side_effect_context()
    return pick, False


@router.get("/{project_id}/material-picks")
async def list_picks(
    project_id: str,
    work_type: str | None = None,
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    query = select(MaterialPick).where(MaterialPick.project_id == project_id)
    if work_type:
        query = query.where(MaterialPick.work_type == work_type)
    if status:
        query = query.where(MaterialPick.status == status)
    result = await db.execute(query.order_by(MaterialPick.created_at.desc()))
    return [_out(pick) for pick in result.scalars().all()]


@router.post("/{project_id}/material-picks")
async def create_pick(
    project_id: str,
    body: PickIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    pick, replayed = await _create_pick(
        db,
        project_id=project_id,
        user=user,
        body=body,
        scope=MATERIAL_PICK_CREATE_SCOPE,
    )
    response = _out(pick)
    response["replayed"] = replayed
    return response


async def _transition_endpoint(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
    user: User,
    action: pick_svc.MaterialPickAction,
    reason: str | None = None,
) -> dict:
    try:
        pick, changed, event = await pick_svc.transition_pick(
            db,
            project_id=project_id,
            pick_id=pick_id,
            action=action,
            actor_id=user.id,
            reason=reason,
        )
    except ValueError as error:
        raise _transition_error(error) from error
    if not pick:
        raise HTTPException(404)
    if changed and event:
        await _deliver_transition(
            db,
            project_id=project_id,
            user=user,
            pick=pick,
            event=event,
        )
    response = _out(pick)
    response["replayed"] = not changed
    return response


@router.post("/{project_id}/material-picks/{pick_id}/submit")
async def submit_pick(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    return await _transition_endpoint(
        db,
        project_id=project_id,
        pick_id=pick_id,
        user=user,
        action="submit",
    )


@router.post("/{project_id}/material-picks/{pick_id}/approve")
async def approve_pick(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    return await _transition_endpoint(
        db,
        project_id=project_id,
        pick_id=pick_id,
        user=user,
        action="approve",
    )


@router.post("/{project_id}/material-picks/{pick_id}/reject")
async def reject_pick(
    project_id: str,
    pick_id: str,
    body: RejectPickIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    return await _transition_endpoint(
        db,
        project_id=project_id,
        pick_id=pick_id,
        user=user,
        action="reject",
        reason=body.reason,
    )


@router.post("/{project_id}/material-picks/{pick_id}/analog")
async def add_analog(
    project_id: str,
    pick_id: str,
    body: PickIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    original = await pick_svc.get_pick(db, project_id=project_id, pick_id=pick_id)
    if not original:
        raise HTTPException(404)
    pick, replayed = await _create_pick(
        db,
        project_id=project_id,
        user=user,
        body=body,
        scope=MATERIAL_PICK_ANALOG_SCOPE,
        analog_of_id=pick_id,
    )
    response = _out(pick)
    response["replayed"] = replayed
    return response


@router.post("/{project_id}/material-picks/{pick_id}/sync-price")
async def sync_price(
    project_id: str,
    pick_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Price refresh is allowed only while the material remains an editable draft."""
    await require_project(db, project_id, user, write=True)
    try:
        pick = await pick_svc.require_editable_pick(
            db,
            project_id=project_id,
            pick_id=pick_id,
        )
    except ValueError as error:
        raise _transition_error(error) from error
    if not pick:
        raise HTTPException(404)

    from app.services.price_parser import fetch_price

    price_source = "manual"
    if pick.shop_url:
        pick.price, shop, price_source = await fetch_price(pick.shop_url, pick.price)
        if shop and not pick.shop_name:
            pick.shop_name = shop
    elif not pick.price:
        pick.price = 1000.0
        price_source = "stub"
    await db.commit()
    await db.refresh(pick)
    response = _out(pick)
    response["price_source"] = price_source
    return response
