from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DesignPackage, DomainOutbox, Project, User, UserRole
from app.services import design_package_service as design_svc
from app.services.client_write_idempotency import IdempotencyConflict


@pytest_asyncio.fixture
async def design_db(monkeypatch):
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
        name="Design replay",
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
async def test_design_create_replay_conflict_and_distinct_equal_intents(design_db):
    db = design_db
    _customer, contractor, project = await seed(db)
    request_id = "design-response-loss-001"
    payload = {"title": "  Kitchen concept  ", "file_key": " designs/kitchen.pdf ", "notes": "  v1  "}

    first, replayed = await design_svc.create_package(
        db,
        project=project,
        actor=contractor,
        client_request_id=request_id,
        **payload,
    )
    assert replayed is False
    assert first.version == 1
    assert first.title == "Kitchen concept"
    assert first.file_key == "designs/kitchen.pdf"
    assert first.notes == "v1"

    second, replayed = await design_svc.create_package(
        db,
        project=project,
        actor=contractor,
        client_request_id=request_id,
        **payload,
    )
    assert replayed is True
    assert second.id == first.id
    assert second.version == 1
    assert await count(db, DesignPackage, DesignPackage.project_id == project.id) == 1
    assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == project.id, ClientWriteRequest.scope == design_svc.DESIGN_PACKAGE_CREATE_SCOPE) == 1
    assert await count(db, DomainOutbox, DomainOutbox.aggregate_type == "design_package", DomainOutbox.aggregate_id == first.id) == 1

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await design_svc.create_package(
            db,
            project=project,
            actor=contractor,
            client_request_id=request_id,
            title="Different concept",
            file_key="designs/kitchen.pdf",
            notes="v1",
        )

    third, replayed = await design_svc.create_package(
        db,
        project=project,
        actor=contractor,
        client_request_id="design-response-loss-002",
        **payload,
    )
    assert replayed is False
    assert third.id != first.id
    assert third.version == 2
    assert await count(db, DesignPackage, DesignPackage.project_id == project.id) == 2
    assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == project.id, ClientWriteRequest.scope == design_svc.DESIGN_PACKAGE_CREATE_SCOPE) == 2
    assert await count(db, DomainOutbox, DomainOutbox.aggregate_type == "design_package") == 2
