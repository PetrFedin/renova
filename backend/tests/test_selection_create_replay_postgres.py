from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, SelectionItem, User, UserRole
from app.services import selection_create_service as selection_create


@pytest.mark.asyncio
async def test_selection_same_key_postgres_race_creates_one_row_and_activity(monkeypatch):
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the dedicated migrated-PostgreSQL gate")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"

    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*args, **kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)

    customer_id = str(uuid.uuid4())
    contractor_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    async with Session() as db:
        assert (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        db.add_all([
            User(id=customer_id, phone=f"+799{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer),
            User(id=contractor_id, phone=f"+798{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor),
        ])
        await db.flush()
        db.add(Project(
            id=project_id,
            name="Selection PG race",
            renovation_type="cosmetic",
            customer_id=customer_id,
            contractor_id=contractor_id,
        ))
        await db.commit()

    ready = 0
    both_ready = asyncio.Event()
    release = asyncio.Event()
    guard = asyncio.Lock()
    original_commit = selection_create.commit_client_write

    async def synchronized_commit(*args, **kwargs):
        nonlocal ready
        async with guard:
            ready += 1
            if ready == 2:
                both_ready.set()
        await asyncio.wait_for(release.wait(), 10)
        return await original_commit(*args, **kwargs)

    monkeypatch.setattr(selection_create, "commit_client_write", synchronized_commit)
    payload = {
        "title": "Race tile",
        "room_id": None,
        "category": "tile",
        "sku": "RACE-001",
        "allowance": 5000.0,
        "price": 5200.0,
        "shop_url": None,
        "shop_name": None,
        "notes": "one intent",
    }

    async def create_one():
        async with Session() as db:
            row, replayed = await selection_create.create_selection(
                db,
                project_id=project_id,
                user_id=contractor_id,
                client_request_id="selection-postgres-race-001",
                payload=payload,
            )
            return row.id, replayed

    first = asyncio.create_task(create_one())
    second = asyncio.create_task(create_one())
    try:
        await asyncio.wait_for(both_ready.wait(), 10)
        release.set()
        one, two = await asyncio.wait_for(asyncio.gather(first, second), 15)
        assert one[0] == two[0]
        assert {one[1], two[1]} == {False, True}

        async with Session() as db:
            rows = await db.scalar(select(func.count()).select_from(SelectionItem).where(SelectionItem.project_id == project_id))
            mappings = await db.scalar(select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.scope == selection_create.SCOPE,
            ))
            activities = await db.scalar(select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "selection",
                DomainOutbox.aggregate_id == one[0],
            ))
            assert rows == 1
            assert mappings == 1
            assert activities == 1
    finally:
        release.set()
        for job in (first, second):
            if not job.done():
                job.cancel()
        await asyncio.gather(first, second, return_exceptions=True)
        await engine.dispose()
