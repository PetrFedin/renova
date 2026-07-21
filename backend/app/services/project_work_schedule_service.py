from app.core.timeutil import utc_now
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, StageStatus, User
from app.models.work_schedule import (
    ProjectWorkSchedule,
    ProjectWorkScheduleItem,
    WorkScheduleItemStatus,
    WorkScheduleStatus,
)
from app.schemas.project_work_schedule import WorkScheduleCreateIn, WorkScheduleItemIn, WorkScheduleUpdateIn


def is_project_member(user: User, project: Project) -> bool:
    return user.id in [project.customer_id, project.contractor_id]


def is_project_customer(user: User, project: Project) -> bool:
    return user.id == project.customer_id



async def can_manage_schedule(db: AsyncSession, user: User, project: Project) -> bool:
    """W66/W72: график — contractor owner/foreman; без подрядчика — заказчик; viewer/member — нет."""
    if user.id == project.contractor_id:
        return True
    if not project.contractor_id and user.id == project.customer_id:
        return True
    from app.services.team_service import team_role_for_project

    role = await team_role_for_project(db, user, project)
    return role in ("owner", "foreman")


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
    if not is_project_member(user, project):
        raise HTTPException(status_code=403, detail="project_forbidden")
    return project


def stage_status_to_schedule_status(stage: Stage) -> WorkScheduleItemStatus:
    if stage.status == StageStatus.active:
        return WorkScheduleItemStatus.in_progress
    if stage.status == StageStatus.review:
        return WorkScheduleItemStatus.submitted
    if stage.status == StageStatus.done:
        return WorkScheduleItemStatus.accepted
    if getattr(stage, "needs_rework", False):
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
            item.updated_at = utc_now()
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
                    created_at=utc_now(),
                    updated_at=utc_now(),
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
            created_at=utc_now(),
            updated_at=utc_now(),
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
            .limit(1)
        )
    ).scalars().first()
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
    from app.services.team_service import can_access_project

    if not await can_access_project(db, user, project, write=True):
        raise HTTPException(status_code=403, detail="only_project_members_can_create_schedule")
    if not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_create_schedule")
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
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)


async def update_schedule(db: AsyncSession, schedule: ProjectWorkSchedule, user: User, body: WorkScheduleUpdateIn) -> ProjectWorkSchedule:
    # P0: submitted/confirmed frozen until reject→draft
    if schedule.status == WorkScheduleStatus.confirmed:
        raise HTTPException(status_code=409, detail="confirmed_schedule_cannot_be_edited")
    if schedule.status == WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="submitted_schedule_cannot_be_edited")
    project = await db.get(Project, schedule.project_id)
    if project and not await can_manage_schedule(db, user, project):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_edit_schedule")
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
    schedule.updated_at = utc_now()
    await db.commit()
    await db.refresh(schedule)
    return await attach_items(db, schedule)



async def sync_stages_from_schedule_items(db: AsyncSession, schedule: ProjectWorkSchedule) -> int:
    """W46: после confirm даты items → stages (одно направление, SCHEDULE-SOT)."""
    items = await load_items(db, schedule.id)
    updated = 0
    for item in items:
        if not item.stage_id:
            continue
        stage = await db.get(Stage, item.stage_id)
        if not stage or stage.project_id != schedule.project_id:
            continue
        stage.planned_start = item.planned_start_date
        stage.planned_end = item.planned_finish_date
        updated += 1
    await db.flush()
    return updated


async def submit_schedule(db: AsyncSession, schedule: ProjectWorkSchedule, user: User) -> ProjectWorkSchedule:
    from app.services.team_service import can_access_project

    project_gate = await db.get(Project, schedule.project_id)
    if not project_gate or not await can_access_project(db, user, project_gate, write=True):
        raise HTTPException(status_code=403, detail="project_forbidden")
    if not await can_manage_schedule(db, user, project_gate):
        raise HTTPException(status_code=403, detail="only_contractor_or_foreman_can_submit_schedule")
    items = await load_items(db, schedule.id)
    if not items:
        raise HTTPException(status_code=409, detail="schedule_items_required")
    # E5: each submit after draft/reject bumps version (first submit stays v1)
    prev = int(getattr(schedule, "schedule_version", None) or 1)
    if schedule.status == WorkScheduleStatus.rejected or (
        schedule.submitted_at is not None and schedule.status == WorkScheduleStatus.draft
    ):
        schedule.schedule_version = prev + 1
    elif not getattr(schedule, "schedule_version", None):
        schedule.schedule_version = 1
    schedule.status = WorkScheduleStatus.submitted
    schedule.submitted_by = user.id
    schedule.submitted_at = utc_now()
    schedule.updated_at = utc_now()
    await db.commit()
    await db.refresh(schedule)

    from app.services import activity_service as act
    from app.services import notification_service as notif

    # Project already imported at module level — local import would UnboundLocalError above.
    project = await db.get(Project, schedule.project_id)
    await act.log_event(
        db,
        project_id=schedule.project_id,
        user_id=user.id,
        kind="ScheduleSubmitted",
        title=f"График на согласование: {schedule.title}",
        link_path="/(customer)/(tabs)/calendar",
    )
    if project and project.customer_id and project.customer_id != user.id:
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=schedule.project_id,
            notification_type="schedule_review",
            title="Согласуйте план-график",
            body=schedule.title,
            link_path="/(customer)/(tabs)/calendar",
            return_to="/(customer)/(tabs)/home",
        )
    return await attach_items(db, schedule)


async def confirm_schedule(db: AsyncSession, project: Project, schedule: ProjectWorkSchedule, user: User) -> ProjectWorkSchedule:
    if not is_project_customer(user, project):
        raise HTTPException(status_code=403, detail="only_customer_can_confirm_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_confirm")
    schedule.status = WorkScheduleStatus.confirmed
    schedule.confirmed_by = user.id
    schedule.confirmed_at = utc_now()
    schedule.updated_at = utc_now()
    await sync_stages_from_schedule_items(db, schedule)
    await db.commit()
    await db.refresh(schedule)

    from app.services import activity_service as act
    from app.services import notification_service as notif

    await act.log_event(
        db,
        project_id=schedule.project_id,
        user_id=user.id,
        kind="ScheduleConfirmed",
        title=f"График согласован: {schedule.title}",
        link_path="/(contractor)/(tabs)/calendar",
    )
    if project.contractor_id and project.contractor_id != user.id:
        await notif.notify(
            db,
            user_id=project.contractor_id,
            project_id=schedule.project_id,
            notification_type="schedule_confirmed",
            title="План-график согласован",
            body=schedule.title,
            link_path="/(contractor)/(tabs)/calendar",
            return_to="/(contractor)/(tabs)/home",
        )
    return await attach_items(db, schedule)


async def reject_schedule(db: AsyncSession, project: Project, schedule: ProjectWorkSchedule, user: User, reason: str | None) -> ProjectWorkSchedule:
    if not is_project_customer(user, project):
        raise HTTPException(status_code=403, detail="only_customer_can_reject_schedule")
    if schedule.status != WorkScheduleStatus.submitted:
        raise HTTPException(status_code=409, detail="schedule_must_be_submitted_before_reject")
    schedule.status = WorkScheduleStatus.rejected
    schedule.rejection_reason = reason
    schedule.rejected_by = user.id
    schedule.rejected_at = utc_now()
    schedule.updated_at = utc_now()
    await db.commit()
    await db.refresh(schedule)

    from app.services import activity_service as act
    from app.services import notification_service as notif

    await act.log_event(
        db,
        project_id=schedule.project_id,
        user_id=user.id,
        kind="ScheduleRejected",
        title=f"График отклонён: {schedule.title}",
        body=reason,
        link_path="/(contractor)/(tabs)/calendar",
    )
    if project.contractor_id and project.contractor_id != user.id:
        await notif.notify(
            db,
            user_id=project.contractor_id,
            project_id=schedule.project_id,
            notification_type="schedule_rejected",
            title="План-график на доработку",
            body=reason or schedule.title,
            link_path="/(contractor)/(tabs)/calendar",
            return_to="/(contractor)/(tabs)/home",
        )
    return await attach_items(db, schedule)


async def mark_schedule_items_accepted_for_stage(
    db: AsyncSession, *, project_id: str, stage_id: str
) -> int:
    """После finalize_work_acceptance — отразить приёмку в SoT графика (не наоборот)."""
    rows = list(
        (
            await db.execute(
                select(ProjectWorkScheduleItem)
                .where(ProjectWorkScheduleItem.project_id == project_id)
                .where(ProjectWorkScheduleItem.stage_id == stage_id)
                .where(ProjectWorkScheduleItem.status != WorkScheduleItemStatus.cancelled)
            )
        ).scalars().all()
    )
    now = utc_now()
    today = date.today()
    updated = 0
    for item in rows:
        if item.status == WorkScheduleItemStatus.accepted:
            continue
        item.status = WorkScheduleItemStatus.accepted
        item.progress_percent = 100
        if not item.actual_finish_date:
            item.actual_finish_date = today
        item.delay_days = calculate_delay(item)
        item.updated_at = now
        updated += 1
    return updated


async def sync_stage_from_item_status(db: AsyncSession, item: ProjectWorkScheduleItem, status: WorkScheduleItemStatus) -> None:
    if not item.stage_id:
        return
    stage = await db.get(Stage, item.stage_id)
    if not stage or stage.project_id != item.project_id:
        return

    stage.needs_rework = status == WorkScheduleItemStatus.blocked
    if status == WorkScheduleItemStatus.planned:
        stage.status = StageStatus.planned
        stage.percent_complete = min(stage.percent_complete or 0, 10)
    elif status in [WorkScheduleItemStatus.ready, WorkScheduleItemStatus.in_progress]:
        stage.status = StageStatus.active
        stage.actual_start = stage.actual_start or date.today()
        stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 25)
    elif status == WorkScheduleItemStatus.submitted:
        stage.status = StageStatus.review
        stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 90)
    elif status == WorkScheduleItemStatus.accepted:
        # P0: done только при реальной приёмке заказчика (не по одному статусу этапа)
        if stage.customer_accepted_at:
            stage.status = StageStatus.done
            stage.percent_complete = 100
        else:
            stage.status = StageStatus.review
            stage.percent_complete = max(stage.percent_complete or 0, item.progress_percent or 95)


async def update_item_status(
    db: AsyncSession,
    schedule: ProjectWorkSchedule,
    item: ProjectWorkScheduleItem,
    body_status: WorkScheduleItemStatus,
    *,
    user: User,
    project: Project,
    blocking_reason: str | None = None,
    progress_percent: float | None = None,
) -> ProjectWorkScheduleItem:
    """Смена статуса строки графика.

    P0: status=accepted — только заказчик и только после единой приёмки (customer_accepted_at).
    Исполнитель сдаёт работу через submitted → stage.review → work-acceptances.
    """
    from app.services.schedule_item_transitions import assert_item_transition

    await assert_item_transition(
        db, user=user, project=project, from_status=item.status, to_status=body_status,
    )
    if body_status == WorkScheduleItemStatus.accepted:
        if not is_project_customer(user, project):
            raise HTTPException(status_code=403, detail="only_customer_can_set_schedule_item_accepted")
        # P0 harden: accepted в графике только после единой приёмки (или без привязки к этапу)
        if item.stage_id:
            stage = await db.get(Stage, item.stage_id)
            if not stage or stage.project_id != project.id:
                raise HTTPException(status_code=409, detail="schedule_item_stage_missing")
            if not stage.customer_accepted_at:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "use_work_acceptance_first",
                        "message": "Приёмка этапа — только через «Приёмка» (фото и чеклист), не из графика",
                    },
                )
        elif getattr(item, "requires_customer_acceptance", False):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "use_work_acceptance_first",
                    "message": "Строка требует приёмку заказчика — сначала завершите приёмку этапа",
                },
            )

    item.status = body_status
    item.blocking_reason = blocking_reason
    if progress_percent is not None:
        item.progress_percent = progress_percent
    if body_status == WorkScheduleItemStatus.in_progress and not item.actual_start_date:
        item.actual_start_date = date.today()
    if body_status in [WorkScheduleItemStatus.accepted, WorkScheduleItemStatus.cancelled] and not item.actual_finish_date:
        item.actual_finish_date = date.today()
    if body_status == WorkScheduleItemStatus.accepted:
        item.progress_percent = max(item.progress_percent or 0, 100)
    item.delay_days = calculate_delay(item)
    item.updated_at = utc_now()
    await sync_stage_from_item_status(db, item, body_status)
    await db.commit()
    await db.refresh(item)
    return item
