"""Server-side transition matrix for work-schedule item statuses (P0)."""
from __future__ import annotations

from fastapi import HTTPException

from app.models.entities import Project, User
from app.models.work_schedule import WorkScheduleItemStatus

# from → to → who may initiate
_TRANSITIONS: dict[tuple[WorkScheduleItemStatus, WorkScheduleItemStatus], str] = {
    (WorkScheduleItemStatus.planned, WorkScheduleItemStatus.ready): "manage",
    (WorkScheduleItemStatus.planned, WorkScheduleItemStatus.cancelled): "manage",
    (WorkScheduleItemStatus.planned, WorkScheduleItemStatus.in_progress): "manage",
    (WorkScheduleItemStatus.ready, WorkScheduleItemStatus.in_progress): "manage",
    (WorkScheduleItemStatus.ready, WorkScheduleItemStatus.cancelled): "manage",
    (WorkScheduleItemStatus.ready, WorkScheduleItemStatus.submitted): "manage",
    (WorkScheduleItemStatus.in_progress, WorkScheduleItemStatus.submitted): "manage",
    (WorkScheduleItemStatus.in_progress, WorkScheduleItemStatus.blocked): "manage",
    (WorkScheduleItemStatus.in_progress, WorkScheduleItemStatus.cancelled): "manage",
    (WorkScheduleItemStatus.blocked, WorkScheduleItemStatus.in_progress): "manage",
    (WorkScheduleItemStatus.blocked, WorkScheduleItemStatus.cancelled): "manage",
    (WorkScheduleItemStatus.submitted, WorkScheduleItemStatus.accepted): "customer",
    (WorkScheduleItemStatus.submitted, WorkScheduleItemStatus.blocked): "customer",
    (WorkScheduleItemStatus.delayed, WorkScheduleItemStatus.in_progress): "manage",
    (WorkScheduleItemStatus.delayed, WorkScheduleItemStatus.blocked): "manage",
}


async def assert_item_transition(
    db,
    *,
    user: User,
    project: Project,
    from_status: WorkScheduleItemStatus,
    to_status: WorkScheduleItemStatus,
) -> None:
    from app.services.project_work_schedule_service import can_manage_schedule, is_project_customer

    if from_status == to_status:
        return
    if from_status in (WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled):
        raise HTTPException(409, detail="schedule_item_terminal_status")
    need = _TRANSITIONS.get((from_status, to_status))
    if not need:
        raise HTTPException(
            409,
            detail={
                "code": "illegal_schedule_item_transition",
                "from": from_status.value if hasattr(from_status, "value") else str(from_status),
                "to": to_status.value if hasattr(to_status, "value") else str(to_status),
            },
        )
    if need == "customer":
        if not is_project_customer(user, project):
            raise HTTPException(403, detail="only_customer_can_apply_transition")
        return
    if need == "manage":
        if not await can_manage_schedule(db, user, project):
            raise HTTPException(403, detail="only_contractor_or_foreman_can_apply_transition")
