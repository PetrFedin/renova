from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.models.entities import User
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem, WorkScheduleStatus
from app.schemas.project_work_schedule import (
    WorkScheduleCreateIn,
    WorkScheduleItemOut,
    WorkScheduleItemStatusIn,
    WorkScheduleOut,
    WorkScheduleRejectIn,
    WorkScheduleUpdateIn,
)
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.project_work_schedule_service import (
    attach_items,
    can_manage_schedule,
    confirm_schedule,
    create_item,
    get_active_schedule,
    get_schedule,
    list_schedules,
    reject_schedule,
    submit_schedule,
    sync_items_from_stages,
    update_item_status,
    update_schedule,
)

router = APIRouter(prefix="/projects/{project_id}/work-schedules", tags=["work-schedules"])
WORK_SCHEDULE_CREATE_SCOPE = "work_schedule.create"


class WorkScheduleCreateCommand(WorkScheduleCreateIn):
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


def _idempotency_conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос графика уже использован с другими данными",
        },
    )


@router.get("", response_model=list[WorkScheduleOut])
async def list_project_work_schedules(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, project_id, user)
    return await list_schedules(db, project_id=project_id)


@router.get("/active", response_model=WorkScheduleOut | None)
async def get_project_active_work_schedule(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user)
    return await get_active_schedule(db, project=project)


@router.post("", response_model=WorkScheduleOut)
async def create_project_work_schedule(
    project_id: str,
    body: WorkScheduleCreateCommand,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create one schedule graph exactly once for a stable client request identity."""
    project = await require_project(db, project_id, user, write=True)
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_create_schedule")

    payload = body.model_dump(exclude={"client_request_id"}, mode="json")
    try:
        replay_id = await replay_entity_id(
            db,
            scope=WORK_SCHEDULE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if replay_id:
        replay = await get_schedule(db, project_id=project_id, schedule_id=replay_id)
        if not replay:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return replay

    schedule = ProjectWorkSchedule(
        project_id=project.id,
        title=body.title,
        description=body.description,
        planned_start_date=body.planned_start_date or project.planned_start_date,
        planned_finish_date=body.planned_finish_date or project.planned_end_date,
        created_by=user.id,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(schedule)
    await db.flush()
    if body.items:
        for index, item in enumerate(body.items):
            await create_item(db, schedule, item, index)
    else:
        await sync_items_from_stages(db, schedule)
    await db.flush()

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=WORK_SCHEDULE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=schedule.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if not created:
        canonical = await get_schedule(db, project_id=project_id, schedule_id=entity_id)
        if not canonical:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return canonical

    await db.refresh(schedule)
    return await attach_items(db, schedule)


@router.get("/{schedule_id}", response_model=WorkScheduleOut)
async def get_project_work_schedule(
    project_id: str,
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, project_id, user)
    schedule = await get_schedule(db, project_id=project_id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    return schedule


@router.put("/{schedule_id}", response_model=WorkScheduleOut)
async def update_project_work_schedule(
    project_id: str,
    schedule_id: str,
    body: WorkScheduleUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    schedule = await get_schedule(db, project_id=project.id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    return await update_schedule(db, schedule=schedule, user=user, body=body)


@router.post("/{schedule_id}/submit", response_model=WorkScheduleOut)
async def submit_project_work_schedule(
    project_id: str,
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    schedule = await get_schedule(db, project_id=project.id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_submit_schedule")
    if schedule.status == WorkScheduleStatus.submitted:
        return schedule
    if schedule.status not in {WorkScheduleStatus.draft, WorkScheduleStatus.rejected}:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "schedule_submit_transition_forbidden",
                "message": "Подтверждённый или архивный график нельзя повторно отправить на согласование",
            },
        )
    return await submit_schedule(db, schedule=schedule, user=user)


@router.post("/{schedule_id}/confirm", response_model=WorkScheduleOut)
async def confirm_project_work_schedule(
    project_id: str,
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    schedule = await get_schedule(db, project_id=project.id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    if user.id != project.customer_id:
        raise HTTPException(status_code=403, detail="only_customer_can_confirm_schedule")
    if schedule.status == WorkScheduleStatus.confirmed:
        return schedule
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_confirm")
    return await confirm_schedule(db, project=project, schedule=schedule, user=user)


@router.post("/{schedule_id}/reject", response_model=WorkScheduleOut)
async def reject_project_work_schedule(
    project_id: str,
    schedule_id: str,
    body: WorkScheduleRejectIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    schedule = await get_schedule(db, project_id=project.id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    if user.id != project.customer_id:
        raise HTTPException(status_code=403, detail="only_customer_can_reject_schedule")
    if schedule.status == WorkScheduleStatus.rejected:
        if (schedule.rejection_reason or None) == (body.reason or None):
            return schedule
        raise HTTPException(
            status_code=409,
            detail={
                "code": "schedule_already_rejected",
                "message": "График уже отклонён с другой причиной",
            },
        )
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_reject")
    return await reject_schedule(db, project=project, schedule=schedule, user=user, reason=body.reason)


@router.post("/{schedule_id}/items/{item_id}/status", response_model=WorkScheduleItemOut)
async def update_project_work_schedule_item_status(
    project_id: str,
    schedule_id: str,
    item_id: str,
    body: WorkScheduleItemStatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    schedule = await get_schedule(db, project_id=project.id, schedule_id=schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    item = await db.get(ProjectWorkScheduleItem, item_id)
    if not item or item.schedule_id != schedule_id or item.project_id != project_id:
        raise HTTPException(status_code=404, detail="work_schedule_item_not_found")
    return await update_item_status(
        db,
        schedule=schedule,
        item=item,
        body_status=body.status,
        user=user,
        project=project,
        blocking_reason=body.blocking_reason,
        progress_percent=body.progress_percent,
    )
