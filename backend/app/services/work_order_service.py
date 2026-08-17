"""Work-order service facade with object-level execution authorization.

The implementation below keeps the established work-order API surface while adding a
fail-closed authorization boundary around lifecycle execution. The mechanically
extracted core module remains private; callers must import this module.
"""
from __future__ import annotations

from datetime import date
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, UserRole, WorkOrder, WorkOrderStatus
from app.services import _work_order_service_core as _core
from app.services.team_service import project_team_membership

# Preserve the complete historical module surface, including private helpers used by
# integrity tests and internal callers. This facade overrides only transition().
for _name in dir(_core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_core, _name)
del _name

logger = logging.getLogger(__name__)

WORK_ORDER_FORBIDDEN = "WORK_ORDER_FORBIDDEN"


def _assignee_id(work_order: WorkOrder) -> str | None:
    """Support ORM rows and legacy structural test doubles consistently."""
    return getattr(work_order, "assignee_id", None)


def _log_execution_forbidden(
    *,
    project: Project,
    work_order: WorkOrder,
    actor_id: str,
    current: str,
    new_status: str,
    team_role: str | None,
) -> None:
    logger.warning(
        "work_order_transition_forbidden",
        extra={
            "project_id": project.id,
            "work_order_id": work_order.id,
            "actor_id": actor_id,
            "assignee_id": _assignee_id(work_order),
            "team_role": team_role,
            "current_status": current,
            "new_status": new_status,
            "reason": "object_execution_acl",
        },
    )


async def _resolve_transition_actor_role(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    actor_role: UserRole | str | None,
) -> UserRole | str:
    """Resolve a missing coarse role without trusting an unrelated contractor actor."""
    if actor_role is not None:
        return actor_role
    if actor_id == project.customer_id:
        return UserRole.customer
    if actor_id in {project.contractor_id, project.foreman_id}:
        return UserRole.contractor
    membership = await project_team_membership(
        db,
        user_id=actor_id,
        contractor_id=project.contractor_id,
    )
    if membership is not None and membership.role != "viewer":
        return UserRole.contractor
    raise ValueError("work_order_actor_unknown")


async def _execution_authorization_basis(
    db: AsyncSession,
    *,
    project: Project,
    work_order: WorkOrder,
    actor_id: str,
    current: str,
    new_status: str,
) -> str:
    """Authorize object-level execution without changing broader project visibility.

    Only the two executor transitions are object-scoped here. Customer execution keeps
    the existing explicit/self-managed rules enforced by validate_transition(). Primary
    contractor owners and foremen keep management override semantics. An ordinary team
    member may execute only the WorkOrder assigned to that exact user.
    """
    if (current, new_status) not in _EXECUTOR_TRANSITIONS:
        return "role_policy"

    assignee_id = _assignee_id(work_order)
    if actor_id == project.customer_id:
        if assignee_id == actor_id:
            return "customer_assignee"
        if project.contractor_id is None and assignee_id is None:
            return "customer_self_managed"
        return "customer_role_policy"

    if actor_id == project.contractor_id:
        return "project_contractor_owner"

    if actor_id == project.foreman_id:
        return "project_foreman"

    membership = await project_team_membership(
        db,
        user_id=actor_id,
        contractor_id=project.contractor_id,
    )
    team_role = membership.role if membership is not None else None

    if team_role in _ASSIGNMENT_MANAGER_TEAM_ROLES:
        return f"team_{team_role}"

    if team_role == "member" and assignee_id == actor_id:
        return "assigned_team_member"

    _log_execution_forbidden(
        project=project,
        work_order=work_order,
        actor_id=actor_id,
        current=current,
        new_status=new_status,
        team_role=team_role,
    )
    raise ValueError(WORK_ORDER_FORBIDDEN)


async def transition(
    db: AsyncSession,
    work_order: WorkOrder,
    new_status: str,
    user_id: str,
    actor_role: UserRole | str | None = None,
    *,
    project: Project | None = None,
) -> WorkOrder:
    """Transition a WorkOrder after row-locking and object-level authorization.

    Authorization is evaluated after the authoritative WorkOrder row is locked. Any
    denial rolls the transaction back before returning so an unauthorized request does
    not keep the lock, mutate lifecycle fields, or prepare outbox side effects.
    """
    if isinstance(work_order, WorkOrder):
        work_order = await _lock_current_work_order(db, work_order)

    project_row = project or await db.get(Project, work_order.project_id)
    if not project_row:
        await db.rollback()
        raise ValueError("work_order_project_missing")

    current = _work_order_status(work_order)
    try:
        effective_role = await _resolve_transition_actor_role(
            db,
            project=project_row,
            actor_id=user_id,
            actor_role=actor_role,
        )
        authorization_basis = await _execution_authorization_basis(
            db,
            project=project_row,
            work_order=work_order,
            actor_id=user_id,
            current=current,
            new_status=new_status,
        )
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
    except BaseException:
        await db.rollback()
        raise

    logger.info(
        "work_order_transition_authorized",
        extra={
            "project_id": project_row.id,
            "work_order_id": work_order.id,
            "actor_id": user_id,
            "assignee_id": _assignee_id(work_order),
            "current_status": current,
            "new_status": new_status,
            "authorization_basis": authorization_basis,
        },
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
