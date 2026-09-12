"""P0 #316: physical PostgreSQL contention for direct WorkOrder client intents."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, User, UserRole, WorkOrder
from app.services import work_order_client_write as writer
from app.services.client_write_idempotency import IdempotencyConflict


@pytest.fixture
async def postgres(monkeypatch):
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the migrated-PostgreSQL recovery gate")
    assert url.startswith("postgresql+asyncpg://"), "replay race proof must use real PostgreSQL"
    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def no_inline(*args, **kwargs):
        return None

    monkeypatch.setattr(writer.work_order_service, "_dispatch_committed_effects", no_inline)
    suffix = uuid.uuid4().hex[:12]
    customer_id = f"wo-pg-user-{suffix}"
    project_id = f"wo-pg-project-{suffix}"
    async with Session() as db:
        assert (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        customer = User(id=customer_id, phone=f"+79{suffix[:9]}", role=UserRole.customer)
        project = Project(
            id=project_id,
            name="Postgres replay",
            renovation_type="cosmetic",
            customer_id=customer_id,
        )
        db.add_all([customer, project])
        await db.commit()
    try:
        yield engine, Session, customer_id, project_id
    finally:
        await engine.dispose()


async def _count(db, model, *where) -> int:
    query = select(func.count()).select_from(model)
    if where:
        query = query.where(*where)
    return int((await db.execute(query)).scalar_one())


async def _assert_blocked(engine, pid: int) -> None:
    async with engine.connect() as conn:
        for _ in range(100):
            blockers = await conn.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid))"),
                {"pid": pid},
            )
            if blockers:
                return
            await asyncio.sleep(0.03)
    raise AssertionError("second WorkOrder writer never contended on the Project row lock")


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
async def test_overlapping_direct_create_is_exactly_once(postgres, monkeypatch, changed):
    engine, Session, customer_id, project_id = postgres
    held = asyncio.Event()
    release = asyncio.Event()
    second_started = asyncio.Event()
    original_prepare = writer.work_order_service.prepare_work_order
    entered = 0
    second_pid: int | None = None

    async def pause_first(*args, **kwargs):
        nonlocal entered
        entered += 1
        if entered == 1:
            held.set()
            await asyncio.wait_for(release.wait(), 10)
        return await original_prepare(*args, **kwargs)

    monkeypatch.setattr(writer.work_order_service, "prepare_work_order", pause_first)

    async def invoke(db, *, title="Race task"):
        return await writer.create_work_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="work-order-postgres-race-key",
            title=title,
            work_type="other",
            budget_planned=100,
            publish=True,
        )

    async def first():
        async with Session() as db:
            return (await invoke(db)).id

    async def second():
        nonlocal second_pid
        async with Session() as db:
            second_pid = await db.scalar(text("SELECT pg_backend_pid()"))
            second_started.set()
            return (await invoke(db, title="Changed race task" if changed else "Race task")).id

    first_job = asyncio.create_task(first())
    second_job = None
    try:
        await asyncio.wait_for(held.wait(), 10)
        second_job = asyncio.create_task(second())
        await asyncio.wait_for(second_started.wait(), 5)
        assert second_pid is not None
        await _assert_blocked(engine, second_pid)
        release.set()
        first_id = await asyncio.wait_for(first_job, 10)
        if changed:
            with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
                await asyncio.wait_for(second_job, 10)
        else:
            assert await asyncio.wait_for(second_job, 10) == first_id

        async with Session() as db:
            assert await _count(db, WorkOrder, WorkOrder.project_id == project_id) == 1
            assert await _count(
                db,
                ClientWriteRequest,
                ClientWriteRequest.scope == writer.WORK_ORDER_CREATE_SCOPE,
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.user_id == customer_id,
            ) == 1
    finally:
        release.set()
        jobs = [job for job in (first_job, second_job) if job is not None]
        for job in jobs:
            if not job.done():
                job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
