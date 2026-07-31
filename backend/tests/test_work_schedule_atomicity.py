from datetime import date
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import DomainOutbox, Project, Stage, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.models.work_schedule import (
    ProjectWorkSchedule,
    ProjectWorkScheduleItem,
    WorkScheduleStatus,
)
from app.services import (
    notification_service,
    outbox_inline_dispatch,
    outbox_service,
    project_work_schedule_service,
)


@pytest_asyncio.fixture
async def schedule_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_schedule(
    db,
    *,
    status: WorkScheduleStatus = WorkScheduleStatus.draft,
    stage_start: date = date(2026, 8, 1),
    stage_finish: date = date(2026, 8, 5),
    item_start: date = date(2026, 8, 10),
    item_finish: date = date(2026, 8, 15),
):
    customer = User(id="customer-schedule", phone="+79990000401", role=UserRole.customer)
    contractor = User(id="contractor-schedule", phone="+79990000402", role=UserRole.contractor)
    project = Project(
        id="project-schedule",
        name="Schedule atomicity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id="stage-schedule",
        project_id=project.id,
        name="Штукатурка",
        planned_start=stage_start,
        planned_end=stage_finish,
        sort_order=1,
    )
    schedule = ProjectWorkSchedule(
        id="schedule-atomicity",
        project_id=project.id,
        status=status,
        title="План работ",
        created_by=contractor.id,
    )
    item = ProjectWorkScheduleItem(
        id="schedule-item",
        schedule_id=schedule.id,
        project_id=project.id,
        stage_id=stage.id,
        title=stage.name,
        planned_start_date=item_start,
        planned_finish_date=item_finish,
        sort_order=1,
    )
    db.add_all([customer, contractor, project, stage, schedule, item])
    await db.commit()
    return customer, contractor, project, stage, schedule, item


@pytest.mark.asyncio
async def test_active_schedule_read_does_not_rewrite_confirmed_item_from_stage(
    schedule_db,
    monkeypatch,
):
    _, _, project, stage, schedule, item = await seed_schedule(
        schedule_db,
        status=WorkScheduleStatus.confirmed,
    )
    project_id = project.id
    schedule_id = schedule.id
    item_id = item.id
    stage_id = stage.id
    commit = AsyncMock()
    monkeypatch.setattr(schedule_db, "commit", commit)

    result = await project_work_schedule_service.get_active_schedule(schedule_db, project)

    assert result is not None
    assert result.id == schedule_id
    assert commit.await_count == 0
    assert await schedule_db.scalar(
        select(ProjectWorkScheduleItem.planned_start_date).where(
            ProjectWorkScheduleItem.id == item_id
        )
    ) == date(2026, 8, 10)
    assert await schedule_db.scalar(
        select(ProjectWorkScheduleItem.planned_finish_date).where(
            ProjectWorkScheduleItem.id == item_id
        )
    ) == date(2026, 8, 15)
    assert await schedule_db.scalar(
        select(Stage.planned_start).where(Stage.id == stage_id)
    ) == date(2026, 8, 1)
    assert await schedule_db.get(Project, project_id) is not None


@pytest.mark.asyncio
async def test_submit_schedule_rolls_back_state_when_outbox_prepare_fails(
    schedule_db,
    monkeypatch,
):
    _, contractor, project, _, schedule, _ = await seed_schedule(schedule_db)
    schedule_id = schedule.id
    monkeypatch.setattr(
        outbox_service,
        "enqueue",
        AsyncMock(side_effect=RuntimeError("schedule_submit_effect_failed")),
    )

    with pytest.raises(RuntimeError, match="schedule_submit_effect_failed"):
        await project_work_schedule_service.submit_schedule(
            schedule_db,
            schedule,
            contractor,
        )

    row = (
        await schedule_db.execute(
            select(
                ProjectWorkSchedule.status,
                ProjectWorkSchedule.submitted_by,
                ProjectWorkSchedule.submitted_at,
            ).where(ProjectWorkSchedule.id == schedule_id)
        )
    ).one()
    assert row.status == WorkScheduleStatus.draft
    assert row.submitted_by is None
    assert row.submitted_at is None
    assert await schedule_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await schedule_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 0


@pytest.mark.asyncio
async def test_confirm_schedule_rolls_back_schedule_and_stage_dates_when_effect_prepare_fails(
    schedule_db,
    monkeypatch,
):
    customer, _, project, stage, schedule, _ = await seed_schedule(
        schedule_db,
        status=WorkScheduleStatus.submitted,
    )
    schedule_id = schedule.id
    stage_id = stage.id
    monkeypatch.setattr(
        project_work_schedule_service,
        "_prepare_schedule_effects",
        AsyncMock(side_effect=RuntimeError("schedule_confirm_effect_failed")),
    )

    with pytest.raises(RuntimeError, match="schedule_confirm_effect_failed"):
        await project_work_schedule_service.confirm_schedule(
            schedule_db,
            project,
            schedule,
            customer,
        )

    schedule_row = (
        await schedule_db.execute(
            select(
                ProjectWorkSchedule.status,
                ProjectWorkSchedule.confirmed_by,
                ProjectWorkSchedule.confirmed_at,
            ).where(ProjectWorkSchedule.id == schedule_id)
        )
    ).one()
    assert schedule_row.status == WorkScheduleStatus.submitted
    assert schedule_row.confirmed_by is None
    assert schedule_row.confirmed_at is None
    stage_dates = (
        await schedule_db.execute(
            select(Stage.planned_start, Stage.planned_end).where(Stage.id == stage_id)
        )
    ).one()
    assert stage_dates.planned_start == date(2026, 8, 1)
    assert stage_dates.planned_end == date(2026, 8, 5)
    assert await schedule_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_reject_schedule_commits_state_activity_and_notification_together(
    schedule_db,
    monkeypatch,
):
    customer, _, project, _, schedule, _ = await seed_schedule(
        schedule_db,
        status=WorkScheduleStatus.submitted,
    )
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    result = await project_work_schedule_service.reject_schedule(
        schedule_db,
        project,
        schedule,
        customer,
        "Сдвиньте электрику раньше",
    )

    assert result.status == WorkScheduleStatus.rejected
    assert result.rejection_reason == "Сдвиньте электрику раньше"
    event_types = list(
        (
            await schedule_db.execute(
                select(DomainOutbox.event_type).order_by(DomainOutbox.event_type)
            )
        ).scalars().all()
    )
    assert event_types == [
        outbox_service.ACTIVITY_EVENT,
        outbox_service.NOTIFICATION_EVENT,
    ]
    assert await schedule_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2
    inline_dispatch.assert_awaited_once_with(
        schedule_db,
        source="work_schedule.reject",
        limit=10,
    )


def test_schedule_notification_types_use_canonical_storage_values():
    assert notification_service.resolve_notification_type("schedule_review").value == "approval"
    assert notification_service.resolve_notification_type("schedule_confirmed").value == "approval"
    assert notification_service.resolve_notification_type("schedule_rejected").value == "issue"
