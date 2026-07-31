"""Заказы работ — детальные задачи по комнатам, датам, статусам."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    Project,
    UserRole,
    WorkOrder,
    WorkOrderStatus,
)
from app.services import outbox_service as outbox

ALLOWED: dict[str, set[str]] = {
    WorkOrderStatus.draft.value: {WorkOrderStatus.published.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.published.value: {WorkOrderStatus.negotiating.value, WorkOrderStatus.approved.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.negotiating.value: {WorkOrderStatus.approved.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.approved.value: {WorkOrderStatus.in_progress.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.in_progress.value: {WorkOrderStatus.review.value, WorkOrderStatus.cancelled.value},
    WorkOrderStatus.review.value: {WorkOrderStatus.done.value, WorkOrderStatus.in_progress.value},
    # `paid` is controlled by the canonical payment/receipt flow, not this endpoint.
    WorkOrderStatus.done.value: set(),
    WorkOrderStatus.paid.value: set(),
    WorkOrderStatus.cancelled.value: set(),
}

_BOTH_ROLES = {UserRole.customer.value, UserRole.contractor.value}
ROLE_ALLOWED: dict[tuple[str, str], set[str]] = {
    (WorkOrderStatus.draft.value, WorkOrderStatus.published.value): _BOTH_ROLES,
    (WorkOrderStatus.draft.value, WorkOrderStatus.cancelled.value): _BOTH_ROLES,
    (WorkOrderStatus.published.value, WorkOrderStatus.negotiating.value): _BOTH_ROLES,
    (WorkOrderStatus.published.value, WorkOrderStatus.approved.value): {UserRole.customer.value},
    (WorkOrderStatus.published.value, WorkOrderStatus.cancelled.value): _BOTH_ROLES,
    (WorkOrderStatus.negotiating.value, WorkOrderStatus.approved.value): {UserRole.customer.value},
    (WorkOrderStatus.negotiating.value, WorkOrderStatus.cancelled.value): _BOTH_ROLES,
    (WorkOrderStatus.approved.value, WorkOrderStatus.in_progress.value): {UserRole.contractor.value},
    (WorkOrderStatus.approved.value, WorkOrderStatus.cancelled.value): _BOTH_ROLES,
    (WorkOrderStatus.in_progress.value, WorkOrderStatus.review.value): {UserRole.contractor.value},
    (WorkOrderStatus.in_progress.value, WorkOrderStatus.cancelled.value): _BOTH_ROLES,
    (WorkOrderStatus.review.value, WorkOrderStatus.done.value): {UserRole.customer.value},
    (WorkOrderStatus.review.value, WorkOrderStatus.in_progress.value): _BOTH_ROLES,
}

_STATUS_LABELS = {
    WorkOrderStatus.published.value: "Опубликовано",
    WorkOrderStatus.negotiating.value: "Обсуждение",
    WorkOrderStatus.approved.value: "Согласовано",
    WorkOrderStatus.in_progress.value: "В работе",
    WorkOrderStatus.review.value: "На приёмке",
    WorkOrderStatus.done.value: "Выполнено",
    WorkOrderStatus.cancelled.value: "Отменено",
}


def wo_dict(w: WorkOrder) -> dict:
    return {
        "id": w.id,
        "project_id": w.project_id,
        "room_id": w.room_id,
        "stage_id": w.stage_id,
        "work_type": w.work_type,
        "title": w.title,
        "status": w.status.value if hasattr(w.status, "value") else w.status,
        "planned_start": w.planned_start.isoformat() if w.planned_start else None,
        "planned_end": w.planned_end.isoformat() if w.planned_end else None,
        "actual_start": w.actual_start.isoformat() if w.actual_start else None,
        "actual_end": w.actual_end.isoformat() if w.actual_end else None,
        "assignee_id": w.assignee_id,
        "chat_thread_id": w.chat_thread_id,
        "budget_planned": w.budget_planned,
        "budget_spent": w.budget_spent,
        "notes": w.notes,
        "created_by": w.created_by,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


async def list_work_orders(db: AsyncSession, project_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(WorkOrder)
            .where(WorkOrder.project_id == project_id)
            .order_by(WorkOrder.planned_start.nullslast())
        )
    ).scalars().all()
    return [wo_dict(w) for w in rows]


async def _prepare_work_order_thread(
    db: AsyncSession,
    *,
    work_order: WorkOrder,
    user_id: str,
) -> ChatThread:
    """Create the work-bound thread without committing the surrounding unit of work."""
    topic = f"work:{work_order.id}"
    existing = (
        await db.execute(
            select(ChatThread)
            .where(
                ChatThread.project_id == work_order.project_id,
                ChatThread.topic == topic,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    thread = ChatThread(
        project_id=work_order.project_id,
        title=f"Работа: {work_order.title}",
        topic=topic,
        created_by=user_id,
    )
    db.add(thread)
    await db.flush()
    db.add(
        ChatMessage(
            thread_id=thread.id,
            user_id=user_id,
            author_role="system",
            message_type=ChatMessageType.system,
            text=f"Чат «{thread.title}» создан",
        )
    )
    await db.flush()
    return thread


async def _dispatch_committed_effects(db: AsyncSession, *, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def create_work_order(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    work_type: str,
    room_id: str | None = None,
    stage_id: str | None = None,
    planned_start: date | None = None,
    planned_end: date | None = None,
    budget_planned: float = 0,
    notes: str | None = None,
    publish: bool = False,
) -> WorkOrder:
    work_order = WorkOrder(
        project_id=project_id,
        room_id=room_id,
        stage_id=stage_id,
        work_type=work_type,
        title=title,
        status=WorkOrderStatus.published if publish else WorkOrderStatus.draft,
        planned_start=planned_start,
        planned_end=planned_end or planned_start,
        budget_planned=budget_planned,
        notes=notes,
        created_by=user_id,
    )
    db.add(work_order)
    try:
        await db.flush()
        thread = await _prepare_work_order_thread(
            db,
            work_order=work_order,
            user_id=user_id,
        )
        work_order.chat_thread_id = thread.id
        await outbox.enqueue(
            db,
            aggregate_type="work_order",
            aggregate_id=work_order.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "work",
                "title": f"Задача: {title}",
                "body": notes,
                "room_id": room_id,
                "work_type": work_type,
                "stage_id": stage_id,
                "link_path": f"/work-order/{work_order.id}",
            },
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(work_order)
    await _dispatch_committed_effects(db, source="work_order.create")
    return work_order


async def update_work_order(db: AsyncSession, work_order: WorkOrder, patch: dict) -> WorkOrder:
    for key in ("title", "work_type", "room_id", "stage_id", "notes", "assignee_id", "budget_planned"):
        if key in patch:
            setattr(work_order, key, patch[key])
    for key in ("planned_start", "planned_end", "actual_start", "actual_end"):
        if key in patch:
            value = patch[key]
            setattr(work_order, key, date.fromisoformat(value) if isinstance(value, str) and value else value)
    work_order.updated_at = utc_now()
    await db.commit()
    await db.refresh(work_order)
    return work_order


def role_value(role: UserRole | str) -> str:
    return role.value if hasattr(role, "value") else str(role)


def infer_actor_role(project: Project, user_id: str) -> UserRole:
    if user_id == project.customer_id:
        return UserRole.customer
    if user_id in {project.contractor_id, project.foreman_id}:
        return UserRole.contractor
    raise ValueError("work_order_actor_unknown")


def validate_transition(current: str, new_status: str, actor_role: UserRole | str) -> None:
    if new_status == WorkOrderStatus.paid.value:
        raise ValueError("payment_transition_required")
    if new_status not in ALLOWED.get(current, set()):
        raise ValueError(f"invalid_work_order_transition:{current}:{new_status}")
    role = role_value(actor_role)
    if role not in ROLE_ALLOWED.get((current, new_status), set()):
        if new_status == WorkOrderStatus.done.value:
            raise ValueError("only_customer_can_accept_work_order")
        raise ValueError("work_order_role_forbidden")


def transition_notification_targets(project: Project, actor_id: str) -> list[str]:
    return sorted(
        {
            user_id
            for user_id in (project.customer_id, project.contractor_id, project.foreman_id)
            if user_id and user_id != actor_id
        }
    )


def transition_notification_copy(current: str, new_status: str, title: str) -> tuple[str, str, str]:
    if new_status == WorkOrderStatus.review.value:
        return "stage_review", f"На приёмке: {title}", "Исполнитель передал работу на проверку."
    if current == WorkOrderStatus.review.value and new_status == WorkOrderStatus.in_progress.value:
        return "issue", f"Доработка: {title}", "Работа возвращена в выполнение."
    if new_status == WorkOrderStatus.approved.value:
        return "approval", f"Согласовано: {title}", "Работу можно начинать."
    if new_status == WorkOrderStatus.in_progress.value:
        return "stage_started", f"Работа начата: {title}", "Статус изменён на «В работе»."
    if new_status == WorkOrderStatus.done.value:
        return "approval", f"Работа принята: {title}", "Заказчик принял результат."
    if new_status == WorkOrderStatus.cancelled.value:
        return "other", f"Работа отменена: {title}", "Операция остановлена."
    if new_status == WorkOrderStatus.negotiating.value:
        return "chat_message", f"Обсуждение: {title}", "Откройте чат работы для согласования деталей."
    return "other", f"Статус работы: {title}", _STATUS_LABELS.get(new_status, new_status)


async def transition(
    db: AsyncSession,
    work_order: WorkOrder,
    new_status: str,
    user_id: str,
    actor_role: UserRole | str | None = None,
    *,
    project: Project | None = None,
) -> WorkOrder:
    project_row = project or await db.get(Project, work_order.project_id)
    if not project_row:
        raise ValueError("work_order_project_missing")
    effective_role = actor_role or infer_actor_role(project_row, user_id)

    current = work_order.status.value if hasattr(work_order.status, "value") else str(work_order.status)
    validate_transition(current, new_status, effective_role)

    work_order.status = WorkOrderStatus(new_status)
    today = date.today()
    if new_status == WorkOrderStatus.in_progress.value and not work_order.actual_start:
        work_order.actual_start = today
    if new_status == WorkOrderStatus.done.value and not work_order.actual_end:
        work_order.actual_end = today
    work_order.updated_at = utc_now()

    notification_type, notification_title, notification_body = transition_notification_copy(
        current,
        new_status,
        work_order.title,
    )
    try:
        await outbox.enqueue(
            db,
            aggregate_type="work_order",
            aggregate_id=work_order.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id": work_order.project_id,
                "user_id": user_id,
                "kind": "work_status",
                "title": f"{work_order.title}: {current} → {new_status}",
                "body": f"actor_role={role_value(effective_role)}",
                "room_id": work_order.room_id,
                "work_type": work_order.work_type,
                "stage_id": work_order.stage_id,
                "link_path": f"/work-order/{work_order.id}",
            },
        )
        for target_id in transition_notification_targets(project_row, user_id):
            await outbox.enqueue(
                db,
                aggregate_type="work_order",
                aggregate_id=work_order.id,
                event_type=outbox.NOTIFICATION_EVENT,
                payload={
                    "user_id": target_id,
                    "project_id": work_order.project_id,
                    "notification_type": notification_type,
                    "title": notification_title,
                    "body": notification_body,
                    "link_path": f"/work-order/{work_order.id}",
                    "return_to": None,
                },
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(work_order)
    await _dispatch_committed_effects(db, source="work_order.transition")
    return work_order


async def get_work_order(db: AsyncSession, work_order_id: str) -> WorkOrder | None:
    return (
        await db.execute(select(WorkOrder).where(WorkOrder.id == work_order_id))
    ).scalar_one_or_none()
