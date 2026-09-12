from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DesignPackage, DomainOutbox, Project, User, UserRole
from app.services import design_package_service as design_svc


@pytest.mark.asyncio
async def test_design_same_key_postgres_race_creates_one_version_and_activity(monkeypatch):
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
            name="Design PG race",
            renovation_type="cosmetic",
            customer_id=customer_id,
            contractor_id=contractor_id,
        ))
        await db.commit()

    held = asyncio.Event()
    release = asyncio.Event()
    second_started = asyncio.Event()
    original_commit = design_svc.commit_client_write
    calls = 0
    second_pid: int | None = None

    async def pause_first(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            held.set()
            await asyncio.wait_for(release.wait(), 10)
        return await original_commit(*args, **kwargs)

    monkeypatch.setattr(design_svc, "commit_client_write", pause_first)

    async def create_one(mark_second: bool = False):
        nonlocal second_pid
        async with Session() as db:
            project = await db.get(Project, project_id)
            actor = await db.get(User, contractor_id)
            assert project is not None and actor is not None
            if mark_second:
                second_pid = await db.scalar(text("SELECT pg_backend_pid()"))
                second_started.set()
            package, replayed = await design_svc.create_package(
                db,
                project=project,
                actor=actor,
                client_request_id="design-postgres-race-001",
                title="Race concept",
                file_key="designs/race.pdf",
                notes="one intent",
            )
            return package.id, package.version, replayed

    first = asyncio.create_task(create_one())
    second = None
    try:
        await asyncio.wait_for(held.wait(), 10)
        second = asyncio.create_task(create_one(True))
        await asyncio.wait_for(second_started.wait(), 5)
        assert second_pid is not None

        async with engine.connect() as conn:
            for _ in range(100):
                blockers = await conn.scalar(
                    text("SELECT cardinality(pg_blocking_pids(:pid))"),
                    {"pid": second_pid},
                )
                if blockers:
                    break
                await asyncio.sleep(0.03)
            else:
                raise AssertionError("second design create never contended on the project row")

        release.set()
        one = await asyncio.wait_for(first, 10)
        two = await asyncio.wait_for(second, 10)
        assert one[0] == two[0]
        assert one[1] == two[1] == 1
        assert {one[2], two[2]} == {False, True}

        async with Session() as db:
            packages = await db.scalar(select(func.count()).select_from(DesignPackage).where(DesignPackage.project_id == project_id))
            mappings = await db.scalar(select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.scope == design_svc.DESIGN_PACKAGE_CREATE_SCOPE,
            ))
            activities = await db.scalar(select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "design_package",
                DomainOutbox.aggregate_id == one[0],
            ))
            assert packages == 1
            assert mappings == 1
            assert activities == 1
    finally:
        release.set()
        jobs = [job for job in (first, second) if job is not None]
        for job in jobs:
            if not job.done():
                job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
        await engine.dispose()
