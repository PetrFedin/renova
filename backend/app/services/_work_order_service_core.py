"""Заказы работ — детальные задачи по комнатам, датам, статусам."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import math

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    Project,
    Room,
    Stage,
    UserRole,
    WorkOrder,
    WorkOrderStatus,
)
from app.services import outbox_service as outbox
from app.services.team_service import project_team_membership

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
_EXECUTOR_TRANSITIONS = {
    (WorkOrderStatus.approved.value, WorkOrderStatus.in_progress.value),
    (WorkOrderStatus.in_progress.value, WorkOrderStatus.review.value),
}
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

_ASSIGNMENT_MANAGER_TEAM_ROLES = {"owner", "foreman"}
_EXECUTOR_TEAM_ROLES = {"owner", "foreman", "member"}
_LIFECYCLE_PATCH_FIELDS = {"actual_start", "actual_end"}
# These fields form the customer-approved scope. Post-approval amendments must
# create a fresh proposal/decision rather than edit the accepted WorkOrder row.
_CUSTOMER_APPROVAL_BOUND_FIELDS = frozenset({
    "title", "work_type", "room_id", "stage_id", "planned_start",
    "planned_end", "notes", "assignee_id", "budget_planned",
})
_EDITABLE_WORK_SCOPE_STATES = frozenset({
    WorkOrderStatus.draft.value,
    WorkOrderStatus.published.value,
    WorkOrderStatus.negotiating.value,
})



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


def _normalize_date(value: date | str | None) -> date | None:
    if isinstance(value, str):
        return date.fromisoformat(value) if value else None
    return value


def _validate_planned_dates(planned_start: date | None, planned_end: date | None) -> None:
    if planned_start is not None and planned_end is not None and planned_end < planned_start:
        raise ValueError("work_order_dates_invalid")


def _validate_budget(value: float | int | None) -> float:
    if value is None:
        raise ValueError("work_order_budget_invalid")
    try:
        normalized = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("work_order_budget_invalid") from error
    if not math.isfinite(normalized) or normalized < 0:
        raise ValueError("work_order_budget_invalid")
    return normalized


async def _validate_resource_refs(
    db: AsyncSession,
    *,
    project_id: str,
    room_id: str | None = None,
    stage_id: str | None = None,
    validate_room: bool = True,
    validate_stage: bool = True,
) -> None:
    if validate_room and room_id is not None:
        room_exists = await db.scalar(
            select(Room.id).where(
                Room.id == room_id,
                Room.project_id == project_id,
                Room.is_archived.is_(False),
            )
        )
        if room_exists is None:
            raise ValueError("work_order_room_invalid")
    if validate_stage and stage_id is not None:
        stage_exists = await db.scalar(
            select(Stage.id).where(
                Stage.id == stage_id,
                Stage.project_id == project_id,
            )
        )
        if stage_exists is None:
            raise ValueError("work_order_stage_invalid")


WORK_ORDER_CREATE_SCOPE = "work_order.create"


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
    request_id: str | None = None,
) -> WorkOrder:
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    try:
        if not title.strip() or not work_type.strip():
            raise ValueError("work_order_fields_invalid")
        _validate_planned_dates(planned_start, planned_end)
        normalized_budget = _validate_budget(budget_planned)
        await _validate_resource_refs(
            db,
            project_id=project_id,
            room_id=room_id,
            stage_id=stage_id,
        )
    except BaseException:
        await db.rollback()
        raise

    resolved_planned_end = planned_end or planned_start
    payload = {
        "title": title.strip(),
        "work_type": work_type.strip(),
        "room_id": room_id,
        "stage_id": stage_id,
        "planned_start": planned_start.isoformat() if planned_start else None,
        "planned_end": resolved_planned_end.isoformat() if resolved_planned_end else None,
        "budget_planned": normalized_budget,
        "notes": notes,
        "publish": publish,
    }

    # Offline-queued creates replay X-Offline-Id as request_id: same key + same
    # payload must return the original WorkOrder, never create a duplicate.
    # IdempotencyConflict (same request_id, different payload) propagates to the caller.
    replay_id = await replay_entity_id(
        db,
        scope=WORK_ORDER_CREATE_SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(WorkOrder, replay_id)
        if not existing or existing.project_id != project_id:
            raise ValueError("idempotency_entity_missing")
        return existing

    work_order = WorkOrder(
        project_id=project_id,
        room_id=room_id,
        stage_id=stage_id,
        work_type=work_type.strip(),
        title=title.strip(),
        status=WorkOrderStatus.published if publish else WorkOrderStatus.draft,
        planned_start=planned_start,
        planned_end=resolved_planned_end,
        budget_planned=normalized_budget,
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
        # Commits the WorkOrder, its outbox rows and the request ledger atomically
        # so a lost response can never replay this into a second WorkOrder.
        created, entity_id = await commit_client_write(
            db,
            scope=WORK_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=request_id,
            payload=payload,
            entity_id=work_order.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        existing = await db.get(WorkOrder, entity_id)
        if not existing:
            raise ValueError("idempotency_entity_missing")
        return existing

    await db.refresh(work_order)
    await _dispatch_committed_effects(db, source="work_order.create")
    return work_order


def _normalize_expected_updated_at(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _next_updated_at(previous: datetime | None) -> datetime:
    now = utc_now()
    if now.tzinfo is not None:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)
    if previous is not None:
        previous = _normalize_expected_updated_at(previous)
        if now <= previous:
            return previous + timedelta(microseconds=1)
    return now


async def _lock_work_order_for_patch(
    db: AsyncSession,
    work_order: WorkOrder,
    *,
    expected_updated_at: datetime,
) -> WorkOrder:
    query = (
        select(WorkOrder)
        .where(
            WorkOrder.id == work_order.id,
            WorkOrder.project_id == work_order.project_id,
        )
        .execution_options(populate_existing=True)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    current = (await db.execute(query)).scalar_one_or_none()
    if current is None:
        await db.rollback()
        raise ValueError("work_order_missing")
    if current.updated_at is None or _normalize_expected_updated_at(current.updated_at) != _normalize_expected_updated_at(expected_updated_at):
        await db.rollback()
        raise ValueError("work_order_stale")
    return current


async def _actor_can_manage_assignment(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
) -> bool:
    if actor_id == project.customer_id:
        return True
    if actor_id == project.contractor_id:
        return True
    membership = await project_team_membership(
        db,
        user_id=actor_id,
        contractor_id=project.contractor_id,
    )
    return membership is not None and membership.role in _ASSIGNMENT_MANAGER_TEAM_ROLES


async def _is_project_executor(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
) -> bool:
    if user_id in {project.customer_id, project.contractor_id}:
        return True
    membership = await project_team_membership(
        db,
        user_id=user_id,
        contractor_id=project.contractor_id,
    )
    return membership is not None and membership.role in _EXECUTOR_TEAM_ROLES


async def _validate_assignee_change(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    assignee_id: str | None,
) -> None:
    if not await _actor_can_manage_assignment(db, project=project, actor_id=actor_id):
        raise ValueError("work_order_assignee_forbidden")
    if assignee_id is None:
        return
    # Contractor-side actors may never manufacture customer execution rights.
    if assignee_id == project.customer_id and actor_id != project.customer_id:
        raise ValueError("work_order_assignee_forbidden")
    if not await _is_project_executor(db, project=project, user_id=assignee_id):
        raise ValueError("work_order_assignee_invalid")


async def update_work_order(
    db: AsyncSession,
    work_order: WorkOrder,
    patch: dict,
    *,
    expected_updated_at: datetime,
    actor_id: str,
    project: Project,
) -> WorkOrder:
    current = await _lock_work_order_for_patch(
        db,
        work_order,
        expected_updated_at=expected_updated_at,
    )
    try:
        if project.id != current.project_id:
            raise ValueError("work_order_project_missing")
        if _LIFECYCLE_PATCH_FIELDS.intersection(patch):
            raise ValueError("work_order_lifecycle_field_forbidden")
        # Even the customer cannot silently rewrite an already accepted version.
        # This also blocks status=cancelled, done and paid amendments.
        if (
            _work_order_status(current) not in _EDITABLE_WORK_SCOPE_STATES
            and _CUSTOMER_APPROVAL_BOUND_FIELDS.intersection(patch)
        ):
            raise ValueError("work_order_approved_scope_locked")

        if "title" in patch:
            title = patch["title"]
            if not isinstance(title, str) or not title.strip():
                raise ValueError("work_order_fields_invalid")
            patch["title"] = title.strip()
        if "work_type" in patch:
            work_type = patch["work_type"]
            if not isinstance(work_type, str) or not work_type.strip():
                raise ValueError("work_order_fields_invalid")
            patch["work_type"] = work_type.strip()
        if "budget_planned" in patch:
            patch["budget_planned"] = _validate_budget(patch["budget_planned"])
        if "planned_start" in patch:
            patch["planned_start"] = _normalize_date(patch["planned_start"])
        if "planned_end" in patch:
            patch["planned_end"] = _normalize_date(patch["planned_end"])

        planned_start = patch.get("planned_start", current.planned_start)
        planned_end = patch.get("planned_end", current.planned_end)
        _validate_planned_dates(planned_start, planned_end)

        await _validate_resource_refs(
            db,
            project_id=current.project_id,
            room_id=patch.get("room_id"),
            stage_id=patch.get("stage_id"),
            validate_room="room_id" in patch,
            validate_stage="stage_id" in patch,
        )
        if "assignee_id" in patch:
            await _validate_assignee_change(
                db,
                project=project,
                actor_id=actor_id,
                assignee_id=patch["assignee_id"],
            )

        # Keep the historical accepted values identifiable in an append-only
        # project activity event. This is a proposal edit, not customer approval.
        changed_fields = {
            key: (getattr(current, key), patch[key])
            for key in _CUSTOMER_APPROVAL_BOUND_FIELDS.intersection(patch)
            if getattr(current, key) != patch[key]
        }
        for key in ("title", "work_type", "room_id", "stage_id", "notes", "assignee_id", "budget_planned"):
            if key in patch:
                setattr(current, key, patch[key])
        for key in ("planned_start", "planned_end"):
            if key in patch:
                setattr(current, key, patch[key])
        current.updated_at = _next_updated_at(current.updated_at)
        if changed_fields and _work_order_status(current) in {
            WorkOrderStatus.published.value, WorkOrderStatus.negotiating.value,
        }:
            import json

            audit_diff = {
                key: {
                    "before": value[0].isoformat() if isinstance(value[0], date) else value[0],
                    "after": value[1].isoformat() if isinstance(value[1], date) else value[1],
                }
                for key, value in sorted(changed_fields.items())
            }
            await outbox.enqueue(
                db,
                aggregate_type="work_order",
                aggregate_id=current.id,
                event_type=outbox.ACTIVITY_EVENT,
                payload={
                    "project_id": current.project_id,
                    "user_id": actor_id,
                    "kind": "WorkScopeProposalChanged",
                    "title": f"Условия работы обновлены до согласования: {current.title}",
                    "body": json.dumps(audit_diff, ensure_ascii=False, sort_keys=True),
                    "room_id": current.room_id,
                    "stage_id": current.stage_id,
                    "link_path": f"/work-order/{current.id}",
                },
            )
            # Neither side can change the price/deadline/performer of the
            # pending proposal without the counterparty getting a durable alert.
            other_party = (
                project.customer_id if actor_id != project.customer_id
                else project.contractor_id
            )
            if other_party:
                await outbox.enqueue(
                    db,
                    aggregate_type="work_order",
                    aggregate_id=current.id,
                    event_type=outbox.NOTIFICATION_EVENT,
                    payload={
                        "user_id": other_party,
                        "project_id": current.project_id,
                        "notification_type": "other",
                        "title": "Изменены условия работы до согласования",
                        "body": f"Проверьте новую стоимость, сроки и исполнителя: {current.title}",
                        "link_path": f"/work-order/{current.id}",
                        "return_to": None,
                    },
                )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(current)
    return current


def role_value(role: UserRole | str) -> str:
    return role.value if hasattr(role, "value") else str(role)


def infer_actor_role(project: Project, user_id: str) -> UserRole:
    if user_id == project.customer_id:
        return UserRole.customer
    if user_id == project.contractor_id:
        return UserRole.contractor
    raise ValueError("work_order_actor_unknown")


def customer_can_execute_work_order(
    project: Project,
    work_order: WorkOrder,
    user_id: str,
) -> bool:
    """Allow the project customer to execute only work they truly own.

    A customer-only project may execute an unassigned work order because no contractor
    exists. In a hybrid project, customer execution must be explicit through assignee_id;
    an unassigned or contractor-owned task stays on the contractor side.
    """
    if user_id != project.customer_id:
        return False
    if work_order.assignee_id == user_id:
        return True
    return project.contractor_id is None and work_order.assignee_id is None


def validate_transition(
    current: str,
    new_status: str,
    actor_role: UserRole | str,
    *,
    customer_can_execute: bool = False,
) -> None:
    if new_status == WorkOrderStatus.paid.value:
        raise ValueError("payment_transition_required")
    if new_status not in ALLOWED.get(current, set()):
        raise ValueError(f"invalid_work_order_transition:{current}:{new_status}")
    role = role_value(actor_role)
    if role not in ROLE_ALLOWED.get((current, new_status), set()):
        if (
            customer_can_execute
            and role == UserRole.customer.value
            and (current, new_status) in _EXECUTOR_TRANSITIONS
        ):
            return
        if new_status == WorkOrderStatus.done.value:
            raise ValueError("only_customer_can_accept_work_order")
        raise ValueError("work_order_role_forbidden")


async def transition_notification_targets(
    db: AsyncSession, project: Project, actor_id: str, stage_id: str | None = None
) -> list[str]:
    """Кому уведомление о смене статуса наряда: заказчик, ведущий, команда по роли, технадзор (COM-005)."""
    from app.services import notification_recipients as recipients_svc

    return sorted(
        await recipients_svc.project_recipients(
            db, project, recipients_svc.GENERAL, stage_id=stage_id, exclude=(actor_id,)
        )
    )


def transition_notification_copy(current: str, new_status: str, title: str) -> tuple[str, str, str]:
    if new_status == WorkOrderStatus.review.value:
        return "stage_review", f"На приёмке: {title}", "Работа передана на проверку."
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


def _work_order_status(work_order: WorkOrder) -> str:
    return work_order.status.value if hasattr(work_order.status, "value") else str(work_order.status)


async def _lock_current_work_order(
    db: AsyncSession,
    work_order: WorkOrder,
) -> WorkOrder:
    """Lock and refresh a prefetched work order before validating a state transition.

    API handlers load the row before calling ``transition``. Another request may commit
    between that read and this mutation. ``populate_existing`` makes SQLAlchemy replace
    the identity-map snapshot with the value observed after the row lock is acquired.
    """
    expected_status = _work_order_status(work_order)
    query = (
        select(WorkOrder)
        .where(
            WorkOrder.id == work_order.id,
            WorkOrder.project_id == work_order.project_id,
        )
        .execution_options(populate_existing=True)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    current = (await db.execute(query)).scalar_one_or_none()
    if current is None:
        await db.rollback()
        raise ValueError("work_order_missing")
    if _work_order_status(current) != expected_status:
        await db.rollback()
        raise ValueError("work_order_stale")
    return current


async def transition(
    db: AsyncSession,
    work_order: WorkOrder,
    new_status: str,
    user_id: str,
    actor_role: UserRole | str | None = None,
    *,
    project: Project | None = None,
    expected_updated_at: datetime | None = None,
) -> WorkOrder:
    # The customer's approval authorizes the *specific reviewed proposal
    # version*, never whatever contractor data happens to exist at submit time.
    # A row lock plus timestamp comparison blocks edits between GET and approval.
    if isinstance(work_order, WorkOrder):
        work_order = await _lock_current_work_order(db, work_order)
        if new_status == WorkOrderStatus.approved.value:
            if expected_updated_at is None:
                raise ValueError("work_order_approval_version_required")
            if _normalize_expected_updated_at(work_order.updated_at) != _normalize_expected_updated_at(expected_updated_at):
                raise ValueError("work_order_stale")

    project_row = project or await db.get(Project, work_order.project_id)
    if not project_row:
        raise ValueError("work_order_project_missing")
    if new_status in {
        WorkOrderStatus.approved.value, WorkOrderStatus.done.value,
    } and user_id != project_row.customer_id:
        # A user with the generic "customer" role (e.g. another project's
        # customer) cannot approve another customer's contract by role alone.
        raise ValueError("work_order_customer_owner_required")
    effective_role = actor_role or infer_actor_role(project_row, user_id)

    current = _work_order_status(work_order)
    validate_transition(
        current,
        new_status,
        effective_role,
        customer_can_execute=customer_can_execute_work_order(
            project_row,
            work_order,
            user_id,
        ),
    )

    work_order.status = WorkOrderStatus(new_status)
    today = date.today()
    if new_status == WorkOrderStatus.in_progress.value and not work_order.actual_start:
        work_order.actual_start = today
    if new_status == WorkOrderStatus.done.value and not work_order.actual_end:
        work_order.actual_end = today
    work_order.updated_at = _next_updated_at(work_order.updated_at)

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
        for target_id in await transition_notification_targets(db, project_row, user_id, work_order.stage_id):
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
