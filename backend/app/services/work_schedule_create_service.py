"""Atomic and response-loss-safe project work-schedule creation."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, User
from app.models.work_schedule import ProjectWorkSchedule
from app.schemas.project_work_schedule import WorkScheduleCreateIn
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "work-schedule.create"


def canonical_payload(body: WorkScheduleCreateIn) -> dict:
    return body.model_dump(mode="json", exclude={"client_request_id"})


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise RuntimeError("work_schedule_project_missing")
    return project


async def _revalidate_authority(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
) -> User:
    from fastapi import HTTPException
    from app.services import team_service as team_svc
    from app.services.project_work_schedule_service import can_manage_schedule

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(status_code=403, detail="project_forbidden")
    if not await team_svc.can_access_project(db, actor, project, write=True):
        raise HTTPException(status_code=403, detail="project_forbidden")
    if not await can_manage_schedule(db, actor, project):
        raise HTTPException(
            status_code=403,
            detail="only_contractor_or_foreman_can_create_schedule",
        )
    return actor


async def _load_schedule(
    db: AsyncSession,
    *,
    project_id: str,
    schedule_id: str,
) -> ProjectWorkSchedule | None:
    from app.services.project_work_schedule_service import attach_items

    schedule = (
        await db.execute(
            select(ProjectWorkSchedule).where(
                ProjectWorkSchedule.id == schedule_id,
                ProjectWorkSchedule.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if schedule is not None:
        await attach_items(db, schedule)
    return schedule


async def create_schedule(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    body: WorkScheduleCreateIn,
) -> tuple[ProjectWorkSchedule, bool]:
    """Create one schedule and its initial items exactly once per client intent."""
    from app.services.project_work_schedule_service import (
        attach_items,
        create_item,
        sync_items_from_stages,
    )

    payload = canonical_payload(body)
    try:
        project = await _lock_project(db, project_id)
        actor = await _revalidate_authority(db, project=project, user_id=user_id)

        replay_id = await replay_entity_id(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=body.client_request_id,
            payload=payload,
        )
        if replay_id:
            existing = await _load_schedule(
                db,
                project_id=project_id,
                schedule_id=replay_id,
            )
            if existing is None:
                raise RuntimeError("work_schedule_replay_entity_missing")
            await db.commit()
            return existing, True

        schedule = ProjectWorkSchedule(
            project_id=project.id,
            title=body.title,
            description=body.description,
            planned_start_date=body.planned_start_date or project.planned_start_date,
            planned_finish_date=body.planned_finish_date or project.planned_end_date,
            created_by=actor.id,
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

        created, canonical_schedule_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=schedule.id,
        )
        if not created:
            existing = await _load_schedule(
                db,
                project_id=project_id,
                schedule_id=canonical_schedule_id,
            )
            if existing is None:
                raise RuntimeError("work_schedule_replay_entity_missing")
            return existing, True
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(schedule)
    return await attach_items(db, schedule), False
