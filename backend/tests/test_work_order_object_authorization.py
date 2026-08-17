from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import work_orders as work_order_api
from app.db.base import Base
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.entities import (
    DomainOutbox,
    Project,
    Team,
    TeamMember,
    User,
    UserRole,
    WorkOrder,
    WorkOrderStatus,
)
from app.services import team_service as team_svc
from app.services import work_order_service as service


async def seed_execution_project(db, suffix: str):
    customer = User(
        id=f"wo-customer-{suffix}",
        phone=f"+79001{sum(map(ord, suffix)) % 100000:05d}",
        role=UserRole.customer,
    )
    owner = User(
        id=f"wo-owner-{suffix}",
        phone=f"+79002{sum(map(ord, suffix)) % 100000:05d}",
        role=UserRole.contractor,
    )
    worker_a = User(
        id=f"wo-worker-a-{suffix}",
        phone=f"+79003{sum(map(ord, suffix)) % 100000:05d}",
        role=UserRole.contractor,
    )
    worker_b = User(
        id=f"wo-worker-b-{suffix}",
        phone=f"+79004{sum(map(ord, suffix)) % 100000:05d}",
        role=UserRole.contractor,
    )
    foreman = User(
        id=f"wo-foreman-{suffix}",
        phone=f"+79005{sum(map(ord, suffix)) % 100000:05d}",
        role=UserRole.contractor,
    )
    team = Team(
        id=f"wo-team-{suffix}",
        name="Execution ACL team",
        owner_id=owner.id,
    )
    project = Project(
        id=f"wo-project-{suffix}",
        name="Execution ACL project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=owner.id,
    )
    work_order = WorkOrder(
        id=f"wo-order-{suffix}",
        project_id=project.id,
        title="Монтаж электрики",
        work_type="electrical",
        status=WorkOrderStatus.approved,
        assignee_id=worker_b.id,
        created_by=owner.id,
    )
    db.add_all(
        [
            customer,
            owner,
            worker_a,
            worker_b,
            foreman,
            team,
            TeamMember(
                id=f"wo-owner-membership-{suffix}",
                team_id=team.id,
                user_id=owner.id,
                role="owner",
            ),
            TeamMember(
                id=f"wo-worker-a-membership-{suffix}",
                team_id=team.id,
                user_id=worker_a.id,
                role="member",
            ),
            TeamMember(
                id=f"wo-worker-b-membership-{suffix}",
                team_id=team.id,
                user_id=worker_b.id,
                role="member",
            ),
            TeamMember(
                id=f"wo-foreman-membership-{suffix}",
                team_id=team.id,
                user_id=foreman.id,
                role="foreman",
            ),
            project,
            work_order,
        ]
    )
    await db.commit()
    return customer, owner, worker_a, worker_b, foreman, project, work_order


@pytest.mark.asyncio
async def test_ordinary_member_executes_only_the_assigned_work_order(db, monkeypatch):
    customer, owner, worker_a, worker_b, foreman, project, work_order = await seed_execution_project(
        db,
        "member-scope",
    )
    monkeypatch.setattr(service, "_dispatch_committed_effects", AsyncMock(return_value=None))

    project_id = project.id
    work_order_id = work_order.id
    worker_a_id = worker_a.id
    worker_b_id = worker_b.id

    # Project visibility stays broad enough for collaboration. Execution ownership is
    # the narrower boundary enforced by work_order_service.transition().
    assert await team_svc.can_access_project(db, worker_a, project, write=False) is True
    assert await team_svc.can_access_project(db, worker_a, project, write=True) is True

    with pytest.raises(ValueError, match=service.WORK_ORDER_FORBIDDEN):
        await service.transition(
            db,
            work_order,
            WorkOrderStatus.in_progress.value,
            worker_a_id,
            actor_role=UserRole.contractor,
            project=project,
        )

    # A denial after row locking must release the transaction immediately and leave no
    # lifecycle or durable side effect behind.
    assert db.in_transaction() is False
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    denied_row = await db.get(WorkOrder, work_order_id)
    assert denied_row is not None
    assert denied_row.status == WorkOrderStatus.approved
    assert denied_row.actual_start is None

    project = await db.get(Project, project_id)
    work_order = await db.get(WorkOrder, work_order_id)
    assert project is not None and work_order is not None
    work_order = await service.transition(
        db,
        work_order,
        WorkOrderStatus.in_progress.value,
        worker_b_id,
        actor_role=UserRole.contractor,
        project=project,
    )
    assert work_order.status == WorkOrderStatus.in_progress
    first_success_outbox_count = await db.scalar(select(func.count()).select_from(DomainOutbox))
    assert first_success_outbox_count > 0

    project = await db.get(Project, project_id)
    work_order = await db.get(WorkOrder, work_order_id)
    assert project is not None and work_order is not None
    with pytest.raises(ValueError, match=service.WORK_ORDER_FORBIDDEN):
        await service.transition(
            db,
            work_order,
            WorkOrderStatus.review.value,
            worker_a_id,
            actor_role=UserRole.contractor,
            project=project,
        )
    assert db.in_transaction() is False
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == first_success_outbox_count
    denied_review = await db.get(WorkOrder, work_order_id)
    assert denied_review is not None
    assert denied_review.status == WorkOrderStatus.in_progress

    project = await db.get(Project, project_id)
    work_order = await db.get(WorkOrder, work_order_id)
    assert project is not None and work_order is not None
    work_order = await service.transition(
        db,
        work_order,
        WorkOrderStatus.review.value,
        worker_b_id,
        actor_role=UserRole.contractor,
        project=project,
    )
    assert work_order.status == WorkOrderStatus.review

    db.expire_all()
    fresh = await db.get(WorkOrder, work_order_id)
    assert fresh is not None
    assert fresh.status == WorkOrderStatus.review
    assert fresh.actual_start is not None

    activity_rows = list(
        (
            await db.execute(
                select(DomainOutbox).where(
                    DomainOutbox.aggregate_id == work_order_id,
                    DomainOutbox.event_type == service.outbox.ACTIVITY_EVENT,
                )
            )
        ).scalars().all()
    )
    assert len(activity_rows) == 2
    assert all(json.loads(row.payload_json)["user_id"] == worker_b_id for row in activity_rows)


@pytest.mark.asyncio
async def test_owner_and_foreman_keep_management_override(db, monkeypatch):
    _, owner, _, worker_b, foreman, project, work_order = await seed_execution_project(
        db,
        "manager-override",
    )
    monkeypatch.setattr(service, "_dispatch_committed_effects", AsyncMock(return_value=None))

    first = await service.transition(
        db,
        work_order,
        WorkOrderStatus.in_progress.value,
        owner.id,
        actor_role=UserRole.contractor,
        project=project,
    )
    assert first.status == WorkOrderStatus.in_progress

    second = WorkOrder(
        id="wo-order-foreman-override",
        project_id=project.id,
        title="Монтаж дверей",
        work_type="doors",
        status=WorkOrderStatus.approved,
        assignee_id=worker_b.id,
        created_by=owner.id,
    )
    db.add(second)
    await db.commit()

    project = await db.get(Project, project.id)
    second = await db.get(WorkOrder, second.id)
    assert project is not None and second is not None
    second = await service.transition(
        db,
        second,
        WorkOrderStatus.in_progress.value,
        foreman.id,
        actor_role=UserRole.contractor,
        project=project,
    )
    assert second.status == WorkOrderStatus.in_progress


@pytest.mark.asyncio
async def test_transition_api_maps_object_ownership_denial_to_403(monkeypatch):
    project = SimpleNamespace(id="api-project")
    work_order = SimpleNamespace(id="api-work", project_id="api-project")
    user = SimpleNamespace(id="api-worker-a", role=UserRole.contractor)

    monkeypatch.setattr(work_order_api, "require_project", AsyncMock(return_value=project))
    monkeypatch.setattr(work_order_api.wo_svc, "get_work_order", AsyncMock(return_value=work_order))
    monkeypatch.setattr(
        work_order_api.wo_svc,
        "transition",
        AsyncMock(side_effect=ValueError(service.WORK_ORDER_FORBIDDEN)),
    )

    with pytest.raises(HTTPException) as raised:
        await work_order_api.transition_work_order(
            "api-project",
            "api-work",
            work_order_api.WorkOrderTransition(status=WorkOrderStatus.in_progress.value),
            user=user,
            db=object(),
        )

    assert raised.value.status_code == 403
    assert raised.value.detail == service.WORK_ORDER_FORBIDDEN


@pytest_asyncio.fixture
async def work_order_session_factory(tmp_path):
    db_path = tmp_path / "work-order-object-acl.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_unauthorized_first_session_releases_lock_and_authorized_session_wins(
    work_order_session_factory,
    monkeypatch,
):
    monkeypatch.setattr(service, "_dispatch_committed_effects", AsyncMock(return_value=None))

    async with work_order_session_factory() as seed_db:
        _, _, worker_a, worker_b, _, project, work_order = await seed_execution_project(
            seed_db,
            "two-session-race",
        )
        worker_a_id = worker_a.id
        worker_b_id = worker_b.id
        project_id = project.id
        work_order_id = work_order.id

    # Session A reaches the authoritative-row lock first, is rejected by object ACL,
    # and must rollback before returning. This ordering protects the valid request from
    # a denial that would otherwise keep a row lock open until request teardown.
    async with work_order_session_factory() as session_a:
        project_a = await session_a.get(Project, project_id)
        work_a = await session_a.get(WorkOrder, work_order_id)
        assert project_a is not None and work_a is not None
        with pytest.raises(ValueError, match=service.WORK_ORDER_FORBIDDEN):
            await service.transition(
                session_a,
                work_a,
                WorkOrderStatus.in_progress.value,
                worker_a_id,
                actor_role=UserRole.contractor,
                project=project_a,
            )
        assert session_a.in_transaction() is False

    async with work_order_session_factory() as after_denial:
        assert await after_denial.scalar(select(func.count()).select_from(DomainOutbox)) == 0
        row = await after_denial.get(WorkOrder, work_order_id)
        assert row is not None
        assert row.status == WorkOrderStatus.approved
        assert row.actual_start is None

    async with work_order_session_factory() as session_b:
        project_b = await session_b.get(Project, project_id)
        work_b = await session_b.get(WorkOrder, work_order_id)
        assert project_b is not None and work_b is not None
        result = await service.transition(
            session_b,
            work_b,
            WorkOrderStatus.in_progress.value,
            worker_b_id,
            actor_role=UserRole.contractor,
            project=project_b,
        )
        assert result.status == WorkOrderStatus.in_progress

    async with work_order_session_factory() as verify_db:
        fresh = await verify_db.get(WorkOrder, work_order_id)
        assert fresh is not None
        assert fresh.status == WorkOrderStatus.in_progress
        assert fresh.actual_start is not None
        activity_rows = list(
            (
                await verify_db.execute(
                    select(DomainOutbox).where(
                        DomainOutbox.aggregate_id == work_order_id,
                        DomainOutbox.event_type == service.outbox.ACTIVITY_EVENT,
                    )
                )
            ).scalars().all()
        )
        assert len(activity_rows) == 1
        assert json.loads(activity_rows[0].payload_json)["user_id"] == worker_b_id
