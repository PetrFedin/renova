from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import MaterialPick, MaterialPickStatus, Project, User, UserRole
from app.services import activity_service as act
from app.services import material_pick_service as pick_svc
from app.services import material_supply_service as supply_svc
from app.services import notification_service as notif

router = APIRouter(prefix="/projects", tags=["materials"])
MATERIAL_PICK_CREATE_SCOPE = "material_pick.create"
MATERIAL_PICK_ANALOG_SCOPE = "material_pick.analog"

_SUPPLY_LABELS = {
    "customer_on_hand": "У заказчика",
    "customer_to_buy": "Покупает заказчик",
    "contractor_to_buy": "Покупает исполнитель",
    "contractor_included": "Включено в работы",
    "third_party": "Поставляет третья сторона",
}


def _require_supply_principal(project: Project, user: User) -> None:
    principal_ids = {project.customer_id}
    if project.contractor_id:
        principal_ids.add(project.contractor_id)
    if user.id not in principal_ids:
        raise HTTPException(
            403,
            detail={
                "code": "material_supply_actor_forbidden",
                "message": "Источник и ответственность материала может менять только заказчик или исполнитель проекта",
            },
        )


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
    supply_source: str | None = Field(default=None, max_length=32)
    qty_available: float | None = Field(default=None, ge=0)
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class SupplyIn(BaseModel):
    supply_source: str = Field(min_length=1, max_length=32)
    qty_available: float = Field(ge=0)


class RejectPickIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


def _out(pick: MaterialPick) -> dict:
    supply = supply_svc.snapshot(pick)
    return {
        "id": pick.id,
        "name": pick.name,
        "room_id": pick.room_id,
        "stage_id": pick.stage_id,
        "qty": pick.qty,
        "qty_needed": pick.qty_needed,
        "qty_delivered": pick.qty_delivered,
        "qty_available": supply.qty_available,
        "qty_to_buy": supply.qty_to_buy,
        "material_available": supply.is_available,
        "unit": pick.unit,
        "price": pick.price,
        "shop_url": pick.shop_url,
        "shop_name": pick.shop_name,
        "work_type": pick.work_type,
        "category": pick.category,
        "status": pick.status.value,
        "supply_source": supply_svc.supply_source(pick),
        "analog_of_id": pick.analog_of_id,
        "notes": pick.notes,
        "total": round(pick.qty * pick.price, 2),
    }


def _payload(
    body: PickIn,
    *,
    project: Project,
    user: User,
    analog_of_id: str | None = None,
) -> dict:
    source = body.supply_source or supply_svc.default_source_for_project(project, user)
    available = body.qty_available
    if available is None:
        available = float(body.qty) if source == "customer_on_hand" else 0.0
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
        "supply_source": source,
        "qty_available": float(available),
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
        "material_supply_source_invalid": "Выберите корректный источник материала",
        "material_qty_available_invalid": "Доступное количество не может быть отрицательным",
        "material_qty_available_exceeds_required": "Доступное количество не может превышать требуемое",
        "customer_on_hand_quantity_incomplete": "Для материала у заказчика укажите всё требуемое количество как доступное",
    }
    validation_codes = {
        "material_pick_room_not_found",
        "material_pick_analog_not_found",
        "material_supply_source_invalid",
        "material_qty_available_invalid",
        "material_qty_available_exceeds_required",
        "customer_on_hand_quantity_incomplete",
    }
    return HTTPException(
        422 if code in validation_codes else 409,
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
    project: Project,
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

    project_id = project.id
    payload = _payload(body, project=project, user=user, analog_of_id=analog_of_id)
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
    project = await require_project(db, project_id, user, write=True)
    pick, replayed = await _create_pick(
        db,
        project=project,
        user=user,
        body=body,
        scope=MATERIAL_PICK_CREATE_SCOPE,
    )
    response = _out(pick)
    response["replayed"] = replayed
    return response


@router.patch("/{project_id}/material-picks/{pick_id}/supply")
async def update_supply(
    project_id: str,
    pick_id: str,
    body: SupplyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    _require_supply_principal(project, user)
    try:
        pick, change = await pick_svc.update_supply_truth(
            db,
            project_id=project_id,
            pick_id=pick_id,
            supply_source=body.supply_source,
            qty_available=float(body.qty_available),
        )
    except ValueError as error:
        raise _transition_error(error) from error
    if not pick:
        raise HTTPException(404)
    if change:
        old_label = _SUPPLY_LABELS.get(change.old_source, change.old_source)
        new_label = _SUPPLY_LABELS.get(change.new_source, change.new_source)
        reapproval = " · требуется повторное согласование" if change.requires_reapproval else ""
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="MaterialSupplyUpdated",
            title=f"Источник материала: {pick.name}",
            body=(
                f"{old_label} → {new_label}; доступно "
                f"{change.old_qty_available:g} → {change.new_qty_available:g}{reapproval}"
            ),
            room_id=pick.room_id,
            work_type=pick.work_type,
            link_path="/(customer)/(tabs)/repair?tab=materials",
        )
        if change.requires_reapproval and project.customer_id != user.id:
            await notif.notify(
                db,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="approval",
                title="Изменён источник материала",
                body=f"Повторно согласуйте: {pick.name}",
                link_path="/approvals",
                return_to="/(customer)/(tabs)/home",
            )
    response = _out(pick)
    response["replayed"] = change is None
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
    project = await require_project(db, project_id, user, write=True)
    original = await pick_svc.get_pick(db, project_id=project_id, pick_id=pick_id)
    if not original:
        raise HTTPException(404)
    pick, replayed = await _create_pick(
        db,
        project=project,
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
