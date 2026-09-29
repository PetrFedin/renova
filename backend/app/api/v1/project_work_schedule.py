from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Stage, User
from app.models.work_schedule import ProjectWorkScheduleItem
from app.schemas.project_work_schedule import (
    WorkScheduleCreateIn,
    WorkScheduleItemIn,
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


async def _require_schedule_item_refs(
    db: AsyncSession,
    project_id: str,
    items: list[WorkScheduleItemIn],
    *,
    schedule_id: str | None,
    replacing: bool,
) -> None:
    """Validate all user-controlled child references before schedule mutation.

    The current full-replacement DTO has no client-local item identity, so a
    dependency targeting an existing item cannot remain valid after replacement
    deletes that row. Fail closed instead of creating a dangling dependency.
    """
    for item in items:
        if item.stage_id:
            stage_id = (
                await db.execute(
                    select(Stage.id).where(
                        Stage.id == item.stage_id,
                        Stage.project_id == project_id,
                    )
                )
            ).scalar_one_or_none()
            if stage_id is None:
                raise HTTPException(status_code=404, detail="work_schedule_stage_not_found")

        if not item.depends_on_item_id:
            continue

        if schedule_id is None:
            raise HTTPException(
                status_code=422,
                detail="work_schedule_dependency_create_not_supported",
            )

        dependency_id = (
            await db.execute(
                select(ProjectWorkScheduleItem.id).where(
                    ProjectWorkScheduleItem.id == item.depends_on_item_id,
                    ProjectWorkScheduleItem.schedule_id == schedule_id,
                    ProjectWorkScheduleItem.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if dependency_id is None:
            raise HTTPException(status_code=404, detail="work_schedule_dependency_not_found")

        if replacing:
            raise HTTPException(
                status_code=422,
                detail="work_schedule_dependency_replace_not_supported",
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
    body: WorkScheduleCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=True)
    if body.items:
        await _require_schedule_item_refs(
            db,
            project.id,
            body.items,
            schedule_id=None,
            replacing=False,
        )
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
    if body.items is not None:
        await _require_schedule_item_refs(
            db,
            project.id,
            body.items,
            schedule_id=schedule.id,
            replacing=True,
        )
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
        user=user,
        project=project,
        blocking_reason=body.blocking_reason,
        progress_percent=body.progress_percent,
    )
