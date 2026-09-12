from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, SelectionItem, User, UserRole
from app.services import selection_create_service as selection_create
from app.services.client_write_idempotency import IdempotencyConflict


@pytest_asyncio.fixture
async def selection_db(monkeypatch):
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
        name="Selection replay",
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
async def test_selection_create_replay_conflict_and_distinct_equal_intents(selection_db):
    db = selection_db
    _customer, contractor, project = await seed(db)
    payload = {
        "title": "  Kitchen tile  ",
        "room_id": None,
        "category": "tile",
        "sku": "KT-001",
        "allowance": 4500.0,
        "price": 4700.0,
        "shop_url": "https://example.invalid/tile",
        "shop_name": "Demo shop",
        "notes": "same visible values",
    }

    first, replayed = await selection_create.create_selection(
        db,
        project_id=project.id,
        user_id=contractor.id,
        client_request_id="selection-response-loss-001",
        payload=payload,
    )
    assert replayed is False
    assert first.title == "Kitchen tile"

    second, replayed = await selection_create.create_selection(
        db,
        project_id=project.id,
        user_id=contractor.id,
        client_request_id="selection-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert second.id == first.id
    assert await count(db, SelectionItem, SelectionItem.project_id == project.id) == 1
    assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == project.id, ClientWriteRequest.scope == selection_create.SCOPE) == 1
    assert await count(db, DomainOutbox, DomainOutbox.aggregate_type == "selection", DomainOutbox.aggregate_id == first.id) == 1

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await selection_create.create_selection(
            db,
            project_id=project.id,
            user_id=contractor.id,
            client_request_id="selection-response-loss-001",
            payload={**payload, "price": 4900.0},
        )

    third, replayed = await selection_create.create_selection(
        db,
        project_id=project.id,
        user_id=contractor.id,
        client_request_id="selection-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert third.id != first.id
    assert await count(db, SelectionItem, SelectionItem.project_id == project.id) == 2
    assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == project.id, ClientWriteRequest.scope == selection_create.SCOPE) == 2
    assert await count(db, DomainOutbox, DomainOutbox.aggregate_type == "selection") == 2
