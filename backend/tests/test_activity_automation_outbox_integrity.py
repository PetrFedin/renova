"""Activity-driven automation must be durable, atomic, and replay-safe."""
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import SideEffectDelivery
from app.services import (
    activity_service,
    automation_engine,
    notification_service,
    outbox_service,
)


@pytest_asyncio.fixture
async def automation_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db):
    customer = User(
        id="customer-automation",
        phone="+79990000401",
        role=UserRole.customer,
    )
    contractor = User(
        id="contractor-automation",
        phone="+79990000402",
        role=UserRole.contractor,
    )
    project = Project(
        id="project-automation",
        name="Automation outbox integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id="stage-automation",
        project_id=project.id,
        name="Штукатурка",
        sort_order=1,
        status=StageStatus.review,
    )
    db.add_all([customer, contractor, project, stage])
    await db.commit()
    return customer, contractor, project, stage


@pytest.mark.asyncio
async def test_direct_activity_commits_automation_obligation_and_delivers_once(
    automation_db,
    monkeypatch,
):
    customer, contractor, project, stage = await seed_project(automation_db)
    send_push = AsyncMock(return_value=True)
    monkeypatch.setattr(notification_service, "send_push", send_push)

    event = await activity_service.log_event(
        automation_db,
        project_id=project.id,
        user_id=contractor.id,
        kind="WorkCompleted",
        title="Работа завершена",
        stage_id=stage.id,
        link_path=f"/stage/{stage.id}",
    )

    assert event.kind == "WorkCompleted"
    assert await automation_db.scalar(select(func.count()).select_from(ActivityEvent)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(DomainOutbox)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(SideEffectDelivery)) == 1

    row = (await automation_db.execute(select(DomainOutbox))).scalar_one()
    assert row.event_type == outbox_service.NOTIFICATION_EVENT
    assert row.aggregate_type == "activity_automation"
    assert row.aggregate_id == event.id
    assert row.processed_at is not None
    notification = (await automation_db.execute(select(AppNotification))).scalar_one()
    assert notification.user_id == customer.id
    assert notification.title == "Нужна приёмка"
    send_push.assert_awaited_once()

    assert await outbox_service.dispatch_pending(
        automation_db,
        worker_id="direct-activity-replay",
    ) == 0
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 1


@pytest.mark.asyncio
async def test_outbox_activity_derives_stage_and_creates_deterministic_child_once(
    automation_db,
    monkeypatch,
):
    customer, contractor, project, stage = await seed_project(automation_db)
    send_push = AsyncMock(return_value=True)
    monkeypatch.setattr(notification_service, "send_push", send_push)

    parent = await outbox_service.enqueue(
        automation_db,
        aggregate_type="stage",
        aggregate_id=stage.id,
        event_type=outbox_service.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": contractor.id,
            "kind": "WorkCompleted",
            "title": "Работа завершена",
            "link_path": f"/stage/{stage.id}",
        },
    )
    await automation_db.commit()

    processed = await outbox_service.dispatch_pending(
        automation_db,
        limit=10,
        worker_id="activity-automation-worker",
    )

    assert processed == 2
    assert await automation_db.scalar(select(func.count()).select_from(ActivityEvent)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await automation_db.scalar(select(func.count()).select_from(SideEffectDelivery)) == 2

    rows = list(
        (
            await automation_db.execute(
                select(DomainOutbox).order_by(DomainOutbox.created_at, DomainOutbox.id)
            )
        ).scalars()
    )
    child = next(row for row in rows if row.id != parent.id)
    assert parent.processed_at is not None
    assert child.processed_at is not None
    assert child.event_type == outbox_service.NOTIFICATION_EVENT
    assert child.aggregate_type == "activity_automation"
    assert child.aggregate_id == (
        await automation_db.scalar(select(ActivityEvent.id))
    )
    assert (
        await automation_db.scalar(select(AppNotification.user_id))
    ) == customer.id
    send_push.assert_awaited_once()

    assert await outbox_service.dispatch_pending(
        automation_db,
        worker_id="activity-automation-replay",
    ) == 0
    assert await automation_db.scalar(select(func.count()).select_from(ActivityEvent)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 1
    assert await automation_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2


@pytest.mark.asyncio
async def test_outbox_automation_prepare_failure_remains_retryable_and_visible(
    automation_db,
    monkeypatch,
):
    _, contractor, project, stage = await seed_project(automation_db)
    parent = await outbox_service.enqueue(
        automation_db,
        aggregate_type="stage",
        aggregate_id=stage.id,
        event_type=outbox_service.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": contractor.id,
            "kind": "WorkCompleted",
            "title": "Работа завершена",
            "stage_id": stage.id,
            "link_path": f"/stage/{stage.id}",
        },
    )
    await automation_db.commit()
    monkeypatch.setattr(
        automation_engine,
        "prepare_event_effects",
        AsyncMock(side_effect=RuntimeError("automation_prepare_failed")),
    )

    assert await outbox_service.dispatch_pending(
        automation_db,
        limit=1,
        worker_id="activity-automation-failure",
    ) == 0

    assert await automation_db.scalar(select(func.count()).select_from(ActivityEvent)) == 0
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 0
    assert await automation_db.scalar(select(func.count()).select_from(DomainOutbox)) == 1
    attempts, last_error, processed_at = (
        await automation_db.execute(
            select(
                DomainOutbox.attempts,
                DomainOutbox.last_error,
                DomainOutbox.processed_at,
            ).where(DomainOutbox.id == parent.id)
        )
    ).one()
    assert attempts == 1
    assert last_error == "automation_prepare_failed"
    assert processed_at is None


@pytest.mark.asyncio
async def test_direct_activity_rolls_back_when_required_effect_cannot_be_prepared(
    automation_db,
    monkeypatch,
):
    _, contractor, project, stage = await seed_project(automation_db)
    monkeypatch.setattr(
        automation_engine,
        "prepare_event_effects",
        AsyncMock(side_effect=RuntimeError("automation_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="automation_prepare_failed"):
        await activity_service.log_event(
            automation_db,
            project_id=project.id,
            user_id=contractor.id,
            kind="WorkCompleted",
            title="Работа завершена",
            stage_id=stage.id,
            link_path=f"/stage/{stage.id}",
        )

    assert await automation_db.scalar(select(func.count()).select_from(ActivityEvent)) == 0
    assert await automation_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await automation_db.scalar(select(func.count()).select_from(AppNotification)) == 0
