from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.models.work_schedule import (
    ProjectWorkSchedule,
    ProjectWorkScheduleItem,
    WorkScheduleItemStatus,
    WorkScheduleStatus,
)
from app.schemas.project_work_schedule import WorkScheduleCreateIn, WorkScheduleItemIn, WorkScheduleUpdateIn


async def load_items(db: AsyncSession, schedule_id: str) -> list[ProjectWorkScheduleItem]:
    return list(
        (
            await db.execute(
                select(ProjectWorkScheduleItem)
                .where(ProjectWorkScheduleItem.schedule_id == schedule_id)
                .order_by(ProjectWorkScheduleItem.sort_order.asc(), ProjectWorkScheduleItem.planned_start_date.asc())
            )
        ).scalars().all()
    )


async def attach_items(db: AsyncSession, schedule: ProjectWorkSchedule) -> ProjectWorkSchedule:
    schedule.items = await load_items(db, schedule.id)
    return schedule


async def require_project_member(db: AsyncSession, user: User, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if user.role != UserRole.admin and user.id not in [project.customer_id, project.contractor_id]:
        raise HTTPException(status_code=403, detail="project_forbidden")
    return project


def stage_status_to_schedule_status(stage: Stage) -> WorkScheduleItemStatus:
    if stage.status == StageStatus.active:
        return WorkScheduleItemStatus.in_progress
    if stage.status == StageStatus.review:
        return WorkScheduleItemStatus.submitted
    if stage.status == StageStatus.accepted:
        return WorkScheduleItemStatus.accepted
    if stage.status == StageStatus.rework:
        return WorkScheduleItemStatus.blocked
    return WorkScheduleItemStatus.planned


def calculate_delay(item: ProjectWorkScheduleItem) -> int:
    if item.status in [WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled]:
        return item.delay_days or 0
    if item.planned_finish_date < date.today():
        return max((date.today() - item.planned_finish_date).days, item.delay_days or 0)
    return item.delay_days or 0


async def sync_items_from_stages(db: AsyncSession, schedule: ProjectWorkSchedule) -> None:
    stages = list(
        (
            await db.execute(
                select(Stage)
                .where(Stage.project_id == schedule.project_id)
                .order_by(Stage.sort_order.asc())
            )
        ).scalars().all()
    )
    existing = {item.stage_id: item for item in await load_items(db, schedule.id) if item.stage_id}
    start = schedule.planned_start_date or date.today()

    for index, stage in enumerate(stages):
        item = existing.get(stage.id)
        planned_start = stage.planned_start or start
        planned_finish = stage.planned_end or planned_start
        if item:
            item.title = stage.name
            item.planned_start_date = planned_start
            item.planned_finish_date = planned_finish
            item.status = stage_status_to_schedule_status(stage)
            item.progress_percent = stage.percent_complete or 0
            item.delay_days = calculate_delay(item)
            item.sort_order = stage.sort_order
            item.updated_at = datetime.utcnow()
        else:
            db.add(
                ProjectWorkScheduleItem(
                    schedule_id=schedule.id,
                    project_id=schedule.project_id,
                    stage_id=stage.id,
                    title=stage.name,
                    description=stage.notes,
                    status=stage_status_to_schedule_status(stage),
                    planned_start_date=planned_start,
                    planned_finish_date=planned_finish,
                    progress_percent=stage.percent_complete or 0,
                    sort_order=stage.sort_order if stage.sort_order is not None else index,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )


async def create_item(db: AsyncSession, schedule: ProjectWorkSchedule, body: WorkScheduleItemIn, index: int) -> None:
    db.add(
        ProjectWorkScheduleItem(
            schedule_id=schedule.id,
            project_id=schedule.project_id,
            stage_id=body.stage_id,
            title=body.title,
            description=body.description,
            planned_start_date=body.planned_start_date,
            planned_finish_date=body.planned_finish_date,
            depends_on_item_id=body.depends_on_item_id,
            requires_customer_acceptance=body.requires_customer_acceptance,
            requires_photo=body.requires_photo,
            requires_hidden_work_acceptance=body.requires_hidden_work_acceptance,
            sort_order=body.sort_order or index,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
    )


async def list_schedules(db: AsyncSession, project_id: str) -> list[ProjectWorkSchedule]:
    rows = list(
        (
            await db.execute(
                select(ProjectWorkSchedule)
                .where(ProjectWorkSchedule.project_id == project_id)
                .order_by(ProjectWorkSchedule.created_at.desc())
            )
        ).scalars().all()
    )
    for row in rows:
        await attach_items(db, row)
    return rows


async def get_active_schedule(db: AsyncSession, project: Project) -> ProjectWorkSchedule | None:
    schedule = (
        await db.execute(
            select(ProjectWorkSchedule)
            .where(ProjectWorkSchedule.project_id == project.id)
            .where(ProjectWorkSchedule.status != WorkScheduleStatus.archived)
            .order_by(ProjectWorkSchedule.created_at.desc())
        )
    ).scalar_one_or_none()
    if schedule:
        await sync_items_from_stages(db, schedule)
        await db.commit()
        await db.refresh(schedule)
        await attach_items(db, schedule)
    return schedule


async def get_schedule(db: AsyncSession, project_id: str, schedule_id: str) -> ProjectWorkSchedule | None:
    schedule = (
        await db.execute(
            select(ProjectWorkSchedule)
            .where(ProjectWorkSchedule.project_id == project_id)
            .where(ProjectWorkSchedule.id == schedule_id)
        )
    ).scalar_one_or_none()
    if schedule:
        await attach_items(db, schedule)
    return schedule


async def create_schedule(db: AsyncSession, project: Project, user: User, body: WorkScheduleCreateIn) -> ProjectWorkSchedule:
    if user.role != UserRole.admin and user.id not in [project.contractor_id, project.customer_id]:
        raise HTTPException(status_code=403, detail="only_project_members_can_create_schedule")
    schedule = ProjectWorkSchedule(
        project_id=project.id,
        title=body.title,
        description=body.description,
        planned_start_date=body.planned_start_date or project.planned_start_date,
        planned_finish_date=body.planned_finish_date or project.planned_end_date,
        created_by=user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(schedule)
    await db.flush()
    if body.items:
        for index, item in enumerate(body.items):
            await create_item(db, schedule, item, index)
    else:
        await sync_items_from_stages(db, schedule)
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def update_schedule(db: AsyncSession, schedule: ProjectWorkSchedule, user: User, body: WorkScheduleUpdateIn) -> ProjectWorkSchedule:
    if schedule.status == WorkScheduleStatus.confirmed:
        raise HTTPException(status_code=409, detail="confirmed_schedule_cannot_be_edited")
    if body.title is not None:
        schedule.title = body.title
    if body.description is not None:
        schedule.description = body.description
    if body.planned_start_date is not None:
        schedule.planned_start_date = body.planned_start_date
    if body.planned_finish_date is not None:
        schedule.planned_finish_date = body.planned_finish_date
    if body.items is not None:
        await db.execute(delete(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == schedule.id))
        for index, item in enumerate(body.items):
            await create_item(db, schedule, item, index)
    schedule.status = WorkScheduleStatus.draft if schedule.status == WorkScheduleStatus.rejected else schedule.status
    schedule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def submit_schedule(db: AsyncSession, schedule: ProjectWorkSchedule, user: User) -> ProjectWorkSchedule:
    items = await load_items(db, schedule.id)
    if not items:
        raise HTTPException(status_code=409, detail="schedule_items_required")
    schedule.status = WorkScheduleStatus.submitted
    schedule.submitted_by = user.id
    schedule.submitted_at = datetime.utcnow()
    schedule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def confirm_schedule(db: AsyncSession, project: Project, schedule: ProjectWorkSchedule, user: User) -> ProjectWorkSchedule:
    if user.role != UserRole.admin and user.id != project.customer_id:
        raise HTTPException(status_code=403, detail="only_customer_can_confirm_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_confirm")
    schedule.status = WorkScheduleStatus.confirmed
    schedule.confirmed_by = user.id
    schedule.confirmed_at = datetime.utcnow()
    schedule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def reject_schedule(db: AsyncSession, project: Project, schedule: ProjectWorkSchedule, user: User, reason: str | None) -> ProjectWorkSchedule:
    if user.role != UserRole.admin and user.id != project.customer_id:
        raise HTTPException(status_code=403, detail="only_customer_can_reject_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_reject")
    schedule.status = WorkScheduleStatus.rejected
    schedule.rejection_reason = reason
    schedule.rejected_by = user.id
    schedule.rejected_at = datetime.utcnow()
    schedule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def update_item_status(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    item: ProjectWorkScheduleItem,
    body_status: WorkScheduleItemStatus,
    blocking_reason: str | None = None,
    progress_percent: float | None = None,
) -> ProjectWorkScheduleItem:
    item.status = body_status
    item.blocking_reason = blocking_reason
    if progress_percent is not None:
        item.progress_percent = progress_percent
    if body_status == WorkScheduleItemStatus.in_progress and not item.actual_start_date:
        item.actual_start_date = date.today()
    if body_status in [WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled] and not item.actual_finish_date:
        item.actual_finish_date = date.today()
    item.delay_days = calculate_delay(item)
    item.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return item
