from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.main import app
from app.models.entities import (
    AcceptanceStatus,
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Project,
    ProjectIssue,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.webhook_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import acceptance_mutation_service, notification_service, outbox_service
from app.services.acceptance_mutation_service import (
    AcceptanceAlreadyDecided,
    request_acceptance_with_effects,
    return_acceptance_with_effects,
)


@pytest_asyncio.fixture
async def acceptance_store(tmp_path):
    db_path = tmp_path / "acceptance-mutations.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


async def seed_project(session_factory):
    async with session_factory() as db:
        customer = User(
            id="acceptance-customer",
            phone="+79990005001",
            role=UserRole.customer,
        )
        contractor = User(
            id="acceptance-contractor",
            phone="+79990005002",
            role=UserRole.contractor,
        )
        project = Project(
            id="acceptance-project",
            name="Atomic acceptance",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
        )
        stage = Stage(
            id="acceptance-stage",
            project_id=project.id,
            name="Чистовая отделка",
            sort_order=1,
            status=StageStatus.active,
            percent_complete=80,
        )
        db.add_all([customer, contractor, project, stage])
        await db.commit()
    return project.id, stage.id, customer.id, contractor.id


@pytest.mark.asyncio
async def test_request_commits_stage_acceptance_and_effects_together(
    acceptance_store,
    monkeypatch,
):
    project_id, stage_id, customer_id, contractor_id = await seed_project(acceptance_store)
    monkeypatch.setattr(notification_service, "send_push", pytest.importorskip("unittest.mock").AsyncMock(return_value=True))

    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        result = await request_acceptance_with_effects(
            db,
            project=project,
            stage_id=stage_id,
            requested_by=contractor_id,
            checklist=["Фото", "Уборка"],
            comment="Готово к проверке",
        )
        acceptance_id = result.acceptance.id

    assert result.created is True
    async with acceptance_store() as db:
        row = await db.get(WorkAcceptance, acceptance_id)
        stage = await db.get(Stage, stage_id)
        outbox_count = await db.scalar(select(func.count()).select_from(DomainOutbox))
    assert row.status == AcceptanceStatus.requested
    assert stage.status == StageStatus.review
    assert stage.contractor_ready is True
    assert stage.percent_complete == 90
    assert outbox_count == 2

    async with acceptance_store() as db:
        assert await outbox_service.dispatch_pending(db, limit=10, worker_id="acceptance-request") == 2
    async with acceptance_store() as db:
        assert await db.scalar(select(func.count()).select_from(ActivityEvent)) == 1
        assert await db.scalar(select(func.count()).select_from(AppNotification)) == 1
        notification = (await db.execute(select(AppNotification))).scalar_one()
    assert notification.user_id == customer_id


@pytest.mark.asyncio
async def test_return_is_single_winner_and_effects_are_replay_safe(acceptance_store):
    project_id, stage_id, customer_id, contractor_id = await seed_project(acceptance_store)
    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        requested = await request_acceptance_with_effects(
            db,
            project=project,
            stage_id=stage_id,
            requested_by=contractor_id,
            checklist=None,
            comment=None,
        )
        acceptance_id = requested.acceptance.id

    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        returned = await return_acceptance_with_effects(
            db,
            project=project,
            acceptance_id=acceptance_id,
            returned_by=customer_id,
            checklist=["Исправить шов"],
            quality_score=2,
            comment="Нужна доработка",
            create_issue=True,
            source="app",
        )
    assert returned.acceptance.status == AcceptanceStatus.returned

    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        with pytest.raises(AcceptanceAlreadyDecided):
            await return_acceptance_with_effects(
                db,
                project=project,
                acceptance_id=acceptance_id,
                returned_by=customer_id,
                checklist=None,
                quality_score=1,
                comment="Повтор",
                create_issue=True,
                source="app",
            )

    async with acceptance_store() as db:
        stage = await db.get(Stage, stage_id)
        row = await db.get(WorkAcceptance, acceptance_id)
        issue_count = await db.scalar(select(func.count()).select_from(ProjectIssue))
        outbox_count = await db.scalar(select(func.count()).select_from(DomainOutbox))
    assert row.status == AcceptanceStatus.returned
    assert stage.status == StageStatus.active
    assert stage.needs_rework is True
    assert issue_count == 1
    assert outbox_count == 4


@pytest.mark.asyncio
async def test_effect_failure_rolls_back_return_state_issue_and_new_outbox(
    acceptance_store,
    monkeypatch,
):
    project_id, stage_id, customer_id, contractor_id = await seed_project(acceptance_store)
    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        requested = await request_acceptance_with_effects(
            db,
            project=project,
            stage_id=stage_id,
            requested_by=contractor_id,
            checklist=None,
            comment=None,
        )
        acceptance_id = requested.acceptance.id

    async def fail_effects(*_args, **_kwargs):
        raise RuntimeError("outbox-write-failed")

    monkeypatch.setattr(
        acceptance_mutation_service,
        "_enqueue_return_effects",
        fail_effects,
    )
    async with acceptance_store() as db:
        project = await db.get(Project, project_id)
        with pytest.raises(RuntimeError, match="outbox-write-failed"):
            await return_acceptance_with_effects(
                db,
                project=project,
                acceptance_id=acceptance_id,
                returned_by=customer_id,
                checklist=None,
                quality_score=2,
                comment="Rollback me",
                create_issue=True,
                source="portal",
            )

    async with acceptance_store() as db:
        row = await db.get(WorkAcceptance, acceptance_id)
        stage = await db.get(Stage, stage_id)
        issue_count = await db.scalar(select(func.count()).select_from(ProjectIssue))
        outbox_count = await db.scalar(select(func.count()).select_from(DomainOutbox))
    assert row.status == AcceptanceStatus.requested
    assert stage.status == StageStatus.review
    assert stage.needs_rework is False
    assert issue_count == 0
    assert outbox_count == 2


def test_runtime_has_one_route_per_acceptance_mutation():
    expected = {
        ("/api/v1/projects/{project_id}/work-acceptances", "POST"),
        ("/api/v1/projects/{project_id}/work-acceptances/{acceptance_id}/return", "POST"),
        ("/api/v1/portal/projects/{project_id}/work-acceptances/{acceptance_id}/return", "POST"),
        ("/api/v1/projects/{project_id}/work-acceptances", "GET"),
        ("/api/v1/portal/projects/{project_id}/work-acceptances/{acceptance_id}/accept", "POST"),
    }
    for path, method in expected:
        matches = [
            route
            for route in app.routes
            if isinstance(route, APIRoute)
            and route.path == path
            and method in route.methods
        ]
        assert len(matches) == 1, (path, method, matches)


def test_canonical_routes_do_not_commit_before_effects():
    backend = Path(__file__).resolve().parents[1]
    route_source = (
        backend / "app" / "api" / "v1" / "acceptance_mutations.py"
    ).read_text(encoding="utf-8")
    service_source = (
        backend / "app" / "services" / "acceptance_mutation_service.py"
    ).read_text(encoding="utf-8")
    router_source = (
        backend / "app" / "api" / "v1" / "router.py"
    ).read_text(encoding="utf-8")

    assert "await db.commit()" not in route_source
    assert "request_acceptance_with_effects(" in route_source
    assert "return_acceptance_with_effects(" in route_source
    assert "outbox.enqueue_once(" in service_source
    assert service_source.index("_enqueue_request_effects(") < service_source.index("await db.commit()")
    assert "AcceptanceAlreadyDecided" in service_source
    assert "_WORK_ACCEPTANCE_MUTATION_ROUTES" in router_source
    assert "_PORTAL_REPLACED_ROUTES" in router_source
