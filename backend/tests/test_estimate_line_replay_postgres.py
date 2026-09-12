"""Physical PostgreSQL response-loss race for #406 estimate-line create."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import EstimateLine, Project, User, UserRole
from app.services.budget_service import sync_project_budget_planned
from app.services.client_write_idempotency import commit_client_write
from app.services.estimate_service import prepare_line


async def _count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


async def _assert_blocked(engine, pid: int):
    async with engine.connect() as conn:
        for _ in range(100):
            blockers = await conn.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid))"),
                {"pid": pid},
            )
            if blockers:
                return
            await asyncio.sleep(0.03)
    raise AssertionError("second estimate-line transaction never contended on project budget row")


@pytest.mark.asyncio
async def test_estimate_line_same_key_postgres_race_keeps_one_line_and_budget():
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the dedicated migrated-PostgreSQL gate")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"
    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    customer_id = str(uuid.uuid4())
    contractor_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    payload = {
        "line_type": "material",
        "name": "Concurrent tile",
        "unit": "m2",
        "quantity_planned": 2.5,
        "unit_price": 4000.0,
        "room_id": None,
        "room_name": None,
        "category": "materials",
        "notes": "same logical line",
    }
    request_id = "estimate-line-postgres-race-001"

    try:
        async with Session() as setup:
            assert (await setup.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
            setup.add_all([
                User(id=customer_id, phone=f"+793{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer),
                User(id=contractor_id, phone=f"+792{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor),
            ])
            await setup.flush()
            setup.add(Project(
                id=project_id,
                name="Estimate PG race",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
                budget_planned=0,
            ))
            await setup.commit()

        held = asyncio.Event()
        release = asyncio.Event()
        second_started = asyncio.Event()
        second_pid: int | None = None

        async def first_write():
            async with Session() as db:
                line = await prepare_line(db, project_id, payload)
                await sync_project_budget_planned(db, project_id)
                held.set()  # project budget row is dirty/locked until client-write commit
                await asyncio.wait_for(release.wait(), 10)
                created, entity_id = await commit_client_write(
                    db,
                    scope="estimate_line.create",
                    project_id=project_id,
                    user_id=contractor_id,
                    request_id=request_id,
                    payload=payload,
                    entity_id=line.id,
                )
                assert created is True
                return entity_id

        async def second_write():
            nonlocal second_pid
            async with Session() as db:
                second_pid = await db.scalar(text("SELECT pg_backend_pid()"))
                second_started.set()
                line = await prepare_line(db, project_id, payload)
                await sync_project_budget_planned(db, project_id)
                created, entity_id = await commit_client_write(
                    db,
                    scope="estimate_line.create",
                    project_id=project_id,
                    user_id=contractor_id,
                    request_id=request_id,
                    payload=payload,
                    entity_id=line.id,
                )
                assert created is False
                return entity_id

        first = asyncio.create_task(first_write())
        second = None
        try:
            await asyncio.wait_for(held.wait(), 10)
            second = asyncio.create_task(second_write())
            await asyncio.wait_for(second_started.wait(), 5)
            assert second_pid is not None
            await _assert_blocked(engine, second_pid)
            release.set()
            first_id = await asyncio.wait_for(first, 10)
            second_id = await asyncio.wait_for(second, 10)
            assert first_id == second_id
        finally:
            release.set()
            jobs = [job for job in (first, second) if job is not None]
            for job in jobs:
                if not job.done():
                    job.cancel()
            await asyncio.gather(*jobs, return_exceptions=True)

        async with Session() as verify:
            assert await _count(verify, EstimateLine, EstimateLine.project_id == project_id) == 1
            assert await _count(
                verify,
                ClientWriteRequest,
                ClientWriteRequest.scope == "estimate_line.create",
                ClientWriteRequest.project_id == project_id,
            ) == 1
            project = await verify.get(Project, project_id)
            assert project is not None
            assert float(project.budget_planned) == pytest.approx(10_000.0)
    finally:
        await engine.dispose()
