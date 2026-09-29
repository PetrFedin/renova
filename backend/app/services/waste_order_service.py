"""Waste-order lifecycle with role, state and durable side-effect integrity."""
from __future__ import annotations

from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Room, User, WasteOrder, WasteOrderStatus
from app.services import outbox_service as outbox
from app.services import team_service

WASTE_ORDER_CREATE_SCOPE = "waste_order.create"

_ALLOWED: dict[WasteOrderStatus, set[WasteOrderStatus]] = {
    WasteOrderStatus.draft: {WasteOrderStatus.requested},
    WasteOrderStatus.requested: {
        WasteOrderStatus.scheduled,
        WasteOrderStatus.cancelled,
    },
    WasteOrderStatus.scheduled: {WasteOrderStatus.done},
    WasteOrderStatus.done: set(),
    WasteOrderStatus.cancelled: set(),
}


def _status_value(status: WasteOrderStatus | str) -> str:
    return status.value if hasattr(status, "value") else str(status)


def _is_assigned_executor(project: Project, user_id: str, team_role: str | None = None) -> bool:
    return user_id == project.contractor_id or team_role in {"owner", "foreman"}


def validate_transition(
    *,
    project: Project,
    actor: User,
    current: WasteOrderStatus,
    target: WasteOrderStatus,
    actor_team_role: str | None = None,
) -> None:
    if target not in _ALLOWED.get(current, set()):
        raise ValueError(
            f"invalid_waste_order_transition:{current.value}:{target.value}"
        )
    if target in {WasteOrderStatus.scheduled, WasteOrderStatus.cancelled}:
        if actor.id != project.customer_id:
            raise ValueError("waste_order_actor_forbidden")
        return
    if target in {WasteOrderStatus.requested, WasteOrderStatus.done}:
        if not _is_assigned_executor(project, actor.id, actor_team_role):
            raise ValueError("waste_order_actor_forbidden")
        return
    raise ValueError("waste_order_actor_forbidden")


async def _reload_project(
    db: AsyncSession,
    project_id: str,
    *,
    lock: bool = True,
) -> Project:
    """Fetch the authoritative Project row, bypassing the session identity map.

    A caller (the route handler) fetches `Project` via `require_project()`
    before this service acquires any row lock. If that lock is granted only
    after a wait, a concurrent commit — most importantly a `contractor_id`/
    `customer_id` reassignment — may have landed in between. Using the
    caller's now-stale in-memory `Project` for authority decisions lets a
    revoked assignment ride through on the old identity (#470). Re-fetching
    with `populate_existing=True` forces the ORM to refresh attributes from
    the database instead of returning the cached instance.
    """
    query = (
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    fresh = (await db.execute(query)).scalar_one_or_none()
    if fresh is None or getattr(fresh, "trashed_at", None):
        raise ValueError("waste_order_project_authority_stale")
    return fresh


def _activity_copy(
    order: WasteOrder,
    target: WasteOrderStatus,
) -> tuple[str, str, str | None]:
    volume = f"{order.volume_m3:g} м³"
    if target == WasteOrderStatus.requested:
        return "WasteRequested", f"Запрошен вывоз мусора: {volume}", order.notes
    if target == WasteOrderStatus.scheduled:
        return "WasteApproved", f"Вывоз мусора согласован: {volume}", order.notes
    if target == WasteOrderStatus.cancelled:
        return "WasteRejected", f"Вывоз мусора отклонён: {volume}", order.notes
    if target == WasteOrderStatus.done:
        return "WasteCompleted", f"Вывоз мусора завершён: {volume}", order.notes
    return "WasteUpdated", f"Статус вывоза: {target.value}", order.notes


def _notification_copy(
    order: WasteOrder,
    target: WasteOrderStatus,
) -> tuple[str, str, str]:
    volume = f"{order.volume_m3:g} м³"
    if target == WasteOrderStatus.requested:
        return (
            "approval",
            f"Согласуйте вывоз мусора: {volume}",
            order.notes or "Исполнитель направил заявку на вывоз.",
        )
    if target == WasteOrderStatus.scheduled:
        return (
            "approval",
            f"Вывоз мусора согласован: {volume}",
            order.scheduled_date.isoformat()
            if order.scheduled_date
            else "Заявка согласована заказчиком.",
        )
    if target == WasteOrderStatus.cancelled:
        return (
            "approval",
            f"Вывоз мусора отклонён: {volume}",
            order.notes or "Заказчик отклонил заявку на вывоз.",
        )
    return (
        "other",
        f"Вывоз мусора завершён: {volume}",
        order.notes or "Исполнитель отметил вывоз завершённым.",
    )


def _notification_targets(
    project: Project,
    actor_id: str,
    target: WasteOrderStatus,
) -> list[str]:
    if target in {WasteOrderStatus.requested, WasteOrderStatus.done}:
        candidates = {project.customer_id}
    else:
        candidates = {project.contractor_id}
    return sorted(user_id for user_id in candidates if user_id and user_id != actor_id)


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    order: WasteOrder,
    actor_id: str,
    target: WasteOrderStatus,
) -> None:
    kind, title, body = _activity_copy(order, target)
    await outbox.enqueue(
        db,
        aggregate_type="waste_order",
        aggregate_id=order.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "room_id": order.room_id,
            "link_path": "/approvals",
        },
    )

    notification_type, notification_title, notification_body = _notification_copy(
        order,
        target,
    )
    for target_id in _notification_targets(project, actor_id, target):
        await outbox.enqueue(
            db,
            aggregate_type="waste_order",
            aggregate_id=order.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": target_id,
                "project_id": project.id,
                "notification_type": notification_type,
                "title": notification_title,
                "body": notification_body,
                "link_path": "/approvals",
                "return_to": None,
            },
        )


async def create_order(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    room_id: str | None,
    volume_m3: float,
    waste_type: str,
    scheduled_date: date_type | None,
    price: float,
    notes: str | None,
    client_request_id: str | None,
) -> tuple[WasteOrder, bool]:
    """Create exactly one WasteOrder per client_request_id (#470).

    A lost response after the first commit must replay into the original
    order, not a second one. Same key with a changed canonical payload raises
    IdempotencyConflict instead of silently reinterpreting the earlier
    intent. `room_id` is validated against the URL project before anything is
    written so a room from another project can never be attached here.
    """
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    try:
        fresh_project = await _reload_project(db, project.id)
        if not await team_service.can_access_project(db, actor, fresh_project, write=True):
            raise ValueError("waste_order_project_authority_stale")
        if room_id is not None:
            room_ok = await db.scalar(
                select(Room.id).where(
                    Room.id == room_id,
                    Room.project_id == fresh_project.id,
                )
            )
            if room_ok is None:
                raise ValueError("waste_order_room_invalid")
    except BaseException:
        await db.rollback()
        raise

    payload = {
        "room_id": room_id,
        "volume_m3": volume_m3,
        "waste_type": waste_type,
        "scheduled_date": scheduled_date.isoformat() if scheduled_date else None,
        "price": price,
        "notes": notes,
    }

    # Same client_request_id and exact serialized body arrive on the first
    # attempt and on every mobile offline-queue replay, so a same-key/
    # same-payload replay must resolve to the original order.
    replay_id = await replay_entity_id(
        db,
        scope=WASTE_ORDER_CREATE_SCOPE,
        project_id=fresh_project.id,
        user_id=actor.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(WasteOrder, replay_id)
        if not existing or existing.project_id != fresh_project.id:
            raise ValueError("idempotency_entity_missing")
        return existing, True

    order = WasteOrder(
        project_id=fresh_project.id,
        room_id=room_id,
        volume_m3=volume_m3,
        waste_type=waste_type,
        scheduled_date=scheduled_date,
        price=price,
        notes=notes,
    )
    db.add(order)
    try:
        await db.flush()
        # Commits the WasteOrder and the request ledger atomically so a lost
        # response can never replay this into a second WasteOrder.
        created, entity_id = await commit_client_write(
            db,
            scope=WASTE_ORDER_CREATE_SCOPE,
            project_id=fresh_project.id,
            user_id=actor.id,
            request_id=client_request_id,
            payload=payload,
            entity_id=order.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        existing = await db.get(WasteOrder, entity_id)
        if not existing:
            raise ValueError("idempotency_entity_missing")
        return existing, True

    await db.refresh(order)
    return order, False


async def transition_order(
    db: AsyncSession,
    *,
    project: Project,
    order_id: str,
    actor: User,
    target: WasteOrderStatus,
) -> tuple[WasteOrder | None, bool]:
    """Move one order exactly once and commit state with its durable evidence."""
    query = select(WasteOrder).where(
        WasteOrder.id == order_id,
        WasteOrder.project_id == project.id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    order = (await db.execute(query)).scalar_one_or_none()
    if not order:
        return None, False

    # #470: `project` may have been fetched by the route before this
    # WasteOrder row lock was granted. Reload it now so contractor_id/
    # customer_id assignment semantics below reflect what is actually
    # committed at the moment authority is evaluated, not whatever they were
    # when the request first arrived.
    project = await _reload_project(db, project.id, lock=False)

    current = WasteOrderStatus(_status_value(order.status))
    if current == target:
        return order, True
    actor_team_role = await team_service.team_role_for_project(db, actor, project)
    validate_transition(
        project=project,
        actor=actor,
        current=current,
        target=target,
        actor_team_role=actor_team_role,
    )

    order.status = target
    try:
        await _prepare_effects(
            db,
            project=project,
            order=order,
            actor_id=actor.id,
            target=target,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(order)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source=f"waste_order.{target.value}",
        limit=10,
    )
    return order, False
