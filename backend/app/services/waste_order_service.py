"""Waste-order lifecycle with role, state and durable side-effect integrity."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User, WasteOrder, WasteOrderStatus
from app.services import outbox_service as outbox

_ALLOWED: dict[WasteOrderStatus, set[WasteOrderStatus]] = {
    WasteOrderStatus.draft: {WasteOrderStatus.requested},
    WasteOrderStatus.requested: {WasteOrderStatus.scheduled},
    WasteOrderStatus.scheduled: {WasteOrderStatus.done},
    WasteOrderStatus.done: set(),
    WasteOrderStatus.cancelled: set(),
}


def _status_value(status: WasteOrderStatus | str) -> str:
    return status.value if hasattr(status, "value") else str(status)


def _is_assigned_executor(project: Project, user_id: str) -> bool:
    return user_id in {project.contractor_id, project.foreman_id}


def validate_transition(
    *,
    project: Project,
    actor: User,
    current: WasteOrderStatus,
    target: WasteOrderStatus,
) -> None:
    if target not in _ALLOWED.get(current, set()):
        raise ValueError(
            f"invalid_waste_order_transition:{current.value}:{target.value}"
        )
    if target == WasteOrderStatus.scheduled:
        if actor.id != project.customer_id:
            raise ValueError("waste_order_actor_forbidden")
        return
    if target in {WasteOrderStatus.requested, WasteOrderStatus.done}:
        if not _is_assigned_executor(project, actor.id):
            raise ValueError("waste_order_actor_forbidden")
        return
    raise ValueError("waste_order_actor_forbidden")


def _activity_copy(
    order: WasteOrder,
    target: WasteOrderStatus,
) -> tuple[str, str, str | None]:
    volume = f"{order.volume_m3:g} м³"
    if target == WasteOrderStatus.requested:
        return "WasteRequested", f"Запрошен вывоз мусора: {volume}", order.notes
    if target == WasteOrderStatus.scheduled:
        return "WasteApproved", f"Вывоз мусора согласован: {volume}", order.notes
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
        candidates = {project.contractor_id, project.foreman_id}
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

    current = WasteOrderStatus(_status_value(order.status))
    if current == target:
        return order, True
    validate_transition(
        project=project,
        actor=actor,
        current=current,
        target=target,
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
