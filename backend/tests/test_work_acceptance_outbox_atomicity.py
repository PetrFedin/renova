from unittest.mock import AsyncMock
import json

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.work_acceptances import (
    AcceptanceCreateIn,
    AcceptanceDecisionIn,
    request_acceptance,
    return_work,
)
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    AcceptanceStatus,
    DomainOutbox,
    Project,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.services import outbox_inline_dispatch, outbox_service, stage_review_service


@pytest_asyncio.fixture
async def acceptance_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_acceptance_project(db):
    customer = User(id="customer-acceptance", phone="+79990000201", role=UserRole.customer)
    contractor = User(id="contractor-acceptance", phone="+79990000202", role=UserRole.contractor)
    project = Project(
        id="project-acceptance",
        name="Acceptance atomicity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id="stage-acceptance",
        project_id=project.id,
        name="Штукатурка",
        status=StageStatus.active,
        percent_complete=100,
        assignee_id=contractor.id,
        checklist_json=json.dumps(
            [{"id": "finish", "title": "Завершить работы", "done": True}],
            ensure_ascii=False,
        ),
    )
    result_photo = StagePhoto(
        id="stage-acceptance-result-photo",
        stage_id=stage.id,
        user_id=contractor.id,
        caption="Фото результата",
        image_url="https://example.com/result.jpg",
    )
    db.add_all([customer, contractor, project, stage, result_photo])
    await db.commit()
    return customer, contractor, project, stage


@pytest.mark.asyncio
async def test_request_acceptance_commits_state_and_required_effects_together(
    acceptance_db,
    monkeypatch,
):
    _, contractor, project, stage = await seed_acceptance_project(acceptance_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    response = await request_acceptance(
        project.id,
        AcceptanceCreateIn(stage_id=stage.id, comment="Готово к проверке"),
        user=contractor,
        db=acceptance_db,
    )

    assert response["status"] == AcceptanceStatus.requested.value
    assert await acceptance_db.scalar(select(func.count()).select_from(WorkAcceptance)) == 1
    assert await acceptance_db.scalar(select(Stage.status).where(Stage.id == stage.id)) == StageStatus.review
    assert await acceptance_db.scalar(select(func.count()).select_from(DomainOutbox)) == 3
    assert await acceptance_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 3
    inline_dispatch.assert_awaited_once_with(
        acceptance_db,
        source="stage.review.submit",
        limit=10,
    )


@pytest.mark.asyncio
async def test_request_acceptance_rolls_back_state_when_effect_prepare_fails(
    acceptance_db,
    monkeypatch,
):
    _, contractor, project, stage = await seed_acceptance_project(acceptance_db)
    project_id = project.id
    stage_id = stage.id
    monkeypatch.setattr(
        stage_review_service,
        "_enqueue_activity",
        AsyncMock(side_effect=RuntimeError("request_effect_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="request_effect_prepare_failed"):
        await request_acceptance(
            project_id,
            AcceptanceCreateIn(stage_id=stage_id, comment="Готово к проверке"),
            user=contractor,
            db=acceptance_db,
        )

    assert await acceptance_db.scalar(select(func.count()).select_from(WorkAcceptance)) == 0
    assert await acceptance_db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.active
    assert await acceptance_db.scalar(select(Stage.percent_complete).where(Stage.id == stage_id)) == 100
    assert await acceptance_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_return_acceptance_rolls_back_rework_state_when_effect_prepare_fails(
    acceptance_db,
    monkeypatch,
):
    customer, contractor, project, stage = await seed_acceptance_project(acceptance_db)
    project_id = project.id
    stage_id = stage.id
    stage.status = StageStatus.review
    stage.contractor_ready = True
    acceptance = WorkAcceptance(
        id="acceptance-return",
        project_id=project_id,
        stage_id=stage_id,
        requested_by=contractor.id,
        status=AcceptanceStatus.requested.value,
        comment="Проверьте",
    )
    acceptance_db.add(acceptance)
    await acceptance_db.commit()
    acceptance_id = acceptance.id
    monkeypatch.setattr(
        stage_review_service,
        "_enqueue_notification",
        AsyncMock(side_effect=RuntimeError("return_effect_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="return_effect_prepare_failed"):
        await return_work(
            project_id,
            acceptance_id,
            AcceptanceDecisionIn(comment="Нужно исправить"),
            user=customer,
            db=acceptance_db,
        )

    assert (
        await acceptance_db.scalar(
            select(WorkAcceptance.status).where(WorkAcceptance.id == acceptance_id)
        )
        == AcceptanceStatus.requested.value
    )
    assert await acceptance_db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.review
    assert await acceptance_db.scalar(select(Stage.contractor_ready).where(Stage.id == stage_id)) is True
    assert await acceptance_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_inline_dispatch_failure_keeps_durable_event_and_does_not_raise(
    acceptance_db,
    monkeypatch,
    caplog,
):
    _, contractor, project, _ = await seed_acceptance_project(acceptance_db)
    row = await outbox_service.enqueue(
        acceptance_db,
        aggregate_type="test",
        aggregate_id="acceptance-inline",
        event_type=outbox_service.NOTIFICATION_EVENT,
        payload={
            "user_id": contractor.id,
            "project_id": project.id,
            "notification_type": "stage_review",
            "title": "Тест",
            "body": "Тест",
        },
    )
    await acceptance_db.commit()
    monkeypatch.setattr(
        outbox_service,
        "dispatch_pending",
        AsyncMock(side_effect=RuntimeError("database_temporarily_unavailable")),
    )

    delivered = await outbox_inline_dispatch.dispatch_best_effort(
        acceptance_db,
        source="test.acceptance",
        limit=1,
    )

    assert delivered == 0
    assert await acceptance_db.scalar(
        select(DomainOutbox.processed_at).where(DomainOutbox.id == row.id)
    ) is None
    assert "inline outbox dispatch failed source=test.acceptance" in caplog.text
