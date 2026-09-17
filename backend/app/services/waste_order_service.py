"""Waste-order lifecycle with replay, role, state and durable side-effect integrity."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Room, User, WasteOrder, WasteOrderStatus
from app.services import outbox_service as outbox
from app.services import team_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

CREATE_SCOPE = "waste_order.create"

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


def _validate_target_actor(
    *,
    project: Project,
    actor: User,
    target: WasteOrderStatus,
    actor_team_role: str | None = None,
) -> None:
    if target in {WasteOrderStatus.scheduled, WasteOrderStatus.cancelled}:
        if actor.id != project.customer_id:
            raise ValueError("waste_order_actor_forbidden")
        return
    if target in {WasteOrderStatus.requested, WasteOrderStatus.done}:
        if not _is_assigned_executor(project, actor.id, actor_team_role):
            raise ValueError("waste_order_actor_forbidden")
        return
    raise ValueError("waste_order_actor_forbidden")


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
    _validate_target_actor(
        project=project,
        actor=actor,
        target=target,
        actor_team_role=actor_team_role,
    )


def canonical_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    scheduled_date = payload.get("scheduled_date")
    if scheduled_date is not None and hasattr(scheduled_date, "isoformat"):
        scheduled_date = scheduled_date.isoformat()
    elif scheduled_date is not None:
        scheduled_date = str(scheduled_date)
    return {
        "room_id": payload.get("room_id"),
        "volume_m3": float(payload.get("volume_m3", 1)),
        "waste_type": str(payload.get("waste_type") or "construction"),
        "scheduled_date": scheduled_date,
        "price": float(payload.get("price", 0)),
        "notes": payload.get("notes"),
    }


def _create_entity_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "room_id": payload.get("room_id"),
        "volume_m3": float(payload.get("volume_m3", 1)),
        "waste_type": str(payload.get("waste_type") or "construction"),
        "scheduled_date": payload.get("scheduled_date"),
        "price": float(payload.get("price", 0)),
        "notes": payload.get("notes"),
    }


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "project_not_found")
    return project


async def _revalidate_project_write(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
) -> User:
    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if getattr(project, "trashed_at", None):
        raise HTTPException(404, "project_in_trash")
    if not await team_service.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")
    return actor


async def _validate_create_room(
    db: AsyncSession,
    *,
    project_id: str,
    room_id: str | None,
) -> None:
    if room_id is None:
        return
    found = await db.scalar(
        select(Room.id).where(Room.id == room_id, Room.project_id == project_id)
    )
    if found is None:
        raise HTTPException(404, "room_not_found")


async def _replay_created_order(
    db: AsyncSession,
    *,
    project_id: str,
    order_id: str,
) -> WasteOrder:
    order = await db.get(WasteOrder, order_id)
    if order is None or order.project_id != project_id:
        raise RuntimeError("waste_order_replay_corrupt")
    return order


async def create_order(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    payload: dict[str, Any],
) -> tuple[WasteOrder, bool]:
    """Create one waste order exactly once for one logical client intent."""
    canonical = canonical_create_payload(payload)
    order: WasteOrder | None = None
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_project_write(db, project=project, user_id=user_id)

        replay_id = await replay_entity_id(
            db,
            scope=CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
        )
        if replay_id:
            replayed = await _replay_created_order(
                db,
                project_id=project_id,
                order_id=replay_id,
            )
            await db.commit()
            return replayed, True

        entity_payload = _create_entity_payload(payload)
        await _validate_create_room(
            db,
            project_id=project_id,
            room_id=entity_payload["room_id"],
        )

        order = WasteOrder(project_id=project_id, **entity_payload)
        db.add(order)
        await db.flush()

        created, entity_id = await commit_client_write(
            db,
            scope=CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=canonical,
            entity_id=order.id,
        )
        if not created:
            replayed = await _replay_created_order(
                db,
                project_id=project_id,
                order_id=entity_id,
            )
            await db.commit()
            return replayed, True
    except BaseException:
        await db.rollback()
        raise

    if order is None:
        raise RuntimeError("waste_order_create_missing")
    await db.refresh(order)
    return order, False


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


async def _lock_order(
    db: AsyncSession,
    *,
    project_id: str,
    order_id: str,
) -> WasteOrder | None:
    query = (
        select(WasteOrder)
        .where(
            WasteOrder.id == order_id,
            WasteOrder.project_id == project_id,
        )
        .execution_options(populate_existing=True)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _fresh_transition_context(
    db: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
) -> tuple[Project, User, str | None]:
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    actor = await db.get(User, actor_id, populate_existing=True)
    if (
        project is None
        or actor is None
        or getattr(actor, "deleted_at", None)
        or getattr(project, "trashed_at", None)
        or not await team_service.can_access_project(db, actor, project, write=True)
    ):
        raise ValueError("waste_order_actor_forbidden")
    actor_team_role = await team_service.team_role_for_project(db, actor, project)
    return project, actor, actor_team_role


async def transition_order(
    db: AsyncSession,
    *,
    project: Project,
    order_id: str,
    actor: User,
    target: WasteOrderStatus,
) -> tuple[WasteOrder | None, bool]:
    """Move one order exactly once with fresh post-lock authority and durable evidence."""
    project_id = project.id
    actor_id = actor.id
    order = await _lock_order(db, project_id=project_id, order_id=order_id)
    if not order:
        return None, False

    fresh_project, fresh_actor, actor_team_role = await _fresh_transition_context(
        db,
        project_id=project_id,
        actor_id=actor_id,
    )
    current = WasteOrderStatus(_status_value(order.status))
    if current == target:
        _validate_target_actor(
            project=fresh_project,
            actor=fresh_actor,
            target=target,
            actor_team_role=actor_team_role,
        )
        return order, True

    validate_transition(
        project=fresh_project,
        actor=fresh_actor,
        current=current,
        target=target,
        actor_team_role=actor_team_role,
    )

    order.status = target
    try:
        await _prepare_effects(
            db,
            project=fresh_project,
            order=order,
            actor_id=fresh_actor.id,
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
