from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.models.work_schedule import ProjectWorkScheduleItem
from app.schemas.project_work_schedule import (
    WorkScheduleCreateIn,
    WorkScheduleItemOut,
    WorkScheduleItemStatusIn,
    WorkScheduleOut,
    WorkScheduleRejectIn,
    WorkScheduleUpdateIn,
)
from app.services.project_work_schedule_service import (
    confirm_schedule,
    create_schedule,
    get_active_schedule,
    get_schedule,
    list_schedules,
    reject_schedule,
    submit_schedule,
    update_item_status,
    update_schedule,
)

router = APIRouter(prefix="/projects/{project_id}/work-schedules", tags=["work-schedules"])


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
    body: WorkScheduleCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    return await create_schedule(db, project=project, user=user, body=body)


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
        blocking_reason=body.blocking_reason,
        progress_percent=body.progress_percent,
    )
