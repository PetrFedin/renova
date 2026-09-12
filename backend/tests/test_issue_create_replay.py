from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.services import issue_create_service as issue_create
from app.services.client_write_idempotency import IdempotencyConflict


@pytest_asyncio.fixture
async def issue_db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    from app.services import outbox_inline_dispatch

    async def no_dispatch(*args, **kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    async with Session() as db:
        yield db
    await engine.dispose()


async def seed(db):
    customer = User(id=str(uuid.uuid4()), phone=f"+799{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer)
    contractor = User(id=str(uuid.uuid4()), phone=f"+798{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor)
    project = Project(
        id=str(uuid.uuid4()),
        name="Issue replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


async def count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


@pytest.mark.asyncio
async def test_issue_create_replay_conflict_and_distinct_equal_intents(issue_db):
    db = issue_db
    _customer, contractor, project = await seed(db)
    payload = {
        "title": "Crack near window",
        "description": "same visible values",
        "room_id": None,
        "stage_id": None,
        "severity": "medium",
        "floor_plan_id": None,
        "x_pct": None,
        "y_pct": None,
        "photo_key": None,
    }

    first, replayed = await issue_create.create_issue(
        db,
        project=project,
        user_id=contractor.id,
        client_request_id="issue-response-loss-001",
        payload=payload,
    )
    assert replayed is False

    second, replayed = await issue_create.create_issue(
        db,
        project=project,
        user_id=contractor.id,
        client_request_id="issue-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert second.id == first.id
    assert await count(db, ProjectIssue, ProjectIssue.project_id == project.id) == 1
    assert await count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == issue_create.SCOPE,
    ) == 1
    assert await count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "project_issue",
        DomainOutbox.aggregate_id == first.id,
    ) == 2

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await issue_create.create_issue(
            db,
            project=project,
            user_id=contractor.id,
            client_request_id="issue-response-loss-001",
            payload={**payload, "description": "changed intent"},
        )

    third, replayed = await issue_create.create_issue(
        db,
        project=project,
        user_id=contractor.id,
        client_request_id="issue-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert third.id != first.id
    assert await count(db, ProjectIssue, ProjectIssue.project_id == project.id) == 2
    assert await count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == issue_create.SCOPE,
    ) == 2
    assert await count(db, DomainOutbox, DomainOutbox.aggregate_type == "project_issue") == 4
