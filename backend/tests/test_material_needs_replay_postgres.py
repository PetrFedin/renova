from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, EstimateLine, LineType, MaterialPick, Project, User, UserRole
from app.services import material_need_generation_service as generation


def _postgres_url() -> str:
    value = os.environ.get("MATERIAL_SUPPLY_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("MATERIAL_SUPPLY_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    assert value.startswith("postgresql+asyncpg://"), "material-needs race proof must use real PostgreSQL"
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _seed(Session, *, contractor_actor: bool = False):
    customer_id = _id("needs-cust")
    contractor_id = _id("needs-cont")
    project_id = _id("needs-proj")
    async with Session() as db:
        db.add_all(
            [
                User(
                    id=customer_id,
                    phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.customer,
                ),
                User(
                    id=contractor_id,
                    phone=f"+78{uuid.uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.contractor,
                ),
            ]
        )
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Material needs PostgreSQL replay",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        db.add(
            EstimateLine(
                id=_id("needs-line"),
                project_id=project_id,
                line_type=LineType.material,
                name="Плитка",
                unit="м2",
                quantity_planned=8,
                unit_price=1200,
            )
        )
        await db.commit()
    return (contractor_id if contractor_actor else customer_id), contractor_id, project_id


async def _count(Session, model, *where) -> int:
    async with Session() as db:
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def _project_outbox_filter(project_id: str):
    return (
        DomainOutbox.aggregate_type == generation.AGGREGATE_TYPE,
        DomainOutbox.payload_json.contains(project_id),
    )


@pytest.mark.asyncio
async def test_material_needs_same_key_postgres_race_creates_one_result(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id = await _seed(Session)

    # Both physical sessions must reach the serialization boundary before
    # either is allowed to acquire the PostgreSQL project row lock. This
    # prevents a merely sequential gather() from being mistaken for race proof.
    ready = 0
    guard = asyncio.Lock()
    both_ready = asyncio.Event()
    release = asyncio.Event()
    original_lock = generation._lock_project

    async def synchronized_lock(db, locked_project_id):
        nonlocal ready
        async with guard:
            ready += 1
            if ready == 2:
                both_ready.set()
        await asyncio.wait_for(release.wait(), timeout=10)
        return await original_lock(db, locked_project_id)

    monkeypatch.setattr(generation, "_lock_project", synchronized_lock)

    async def run_one():
        async with Session() as db:
            return await generation.generate_from_estimate(
                db,
                project_id=project_id,
                user_id=actor_id,
                client_request_id="material-needs-pg-race-001",
            )

    first_task = asyncio.create_task(run_one())
    second_task = asyncio.create_task(run_one())
    try:
        await asyncio.wait_for(both_ready.wait(), timeout=10)
        release.set()
        first, second = await asyncio.wait_for(
            asyncio.gather(first_task, second_task),
            timeout=15,
        )
        snapshots = [first[0], second[0]]
        replay_flags = sorted([first[1], second[1]])
        assert replay_flags == [False, True]
        assert snapshots[0] == snapshots[1]
        assert [item["name"] for item in snapshots[0]] == ["Плитка"]
        assert await _count(Session, MaterialPick, MaterialPick.project_id == project_id) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == generation.SCOPE,
        ) == 1

        async with Session() as db:
            request_row = (
                await db.execute(
                    select(ClientWriteRequest).where(
                        ClientWriteRequest.project_id == project_id,
                        ClientWriteRequest.scope == generation.SCOPE,
                        ClientWriteRequest.request_id == "material-needs-pg-race-001",
                    )
                )
            ).scalar_one()
            assert request_row.entity_id != generation.ZERO_RESULT_ID
            assert await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_type == generation.AGGREGATE_TYPE,
                    DomainOutbox.aggregate_id == request_row.entity_id,
                )
            ) == 1
    finally:
        release.set()
        for task in (first_task, second_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(first_task, second_task, return_exceptions=True)
        await engine.dispose()


@pytest.mark.asyncio
async def test_material_needs_rechecks_revoked_contractor_after_lock_wait(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id = await _seed(Session, contractor_actor=True)

    holder = Session()
    reached_project_lock = asyncio.Event()
    original_lock = generation._lock_project

    async def observable_lock(db, locked_project_id):
        reached_project_lock.set()
        return await original_lock(db, locked_project_id)

    monkeypatch.setattr(generation, "_lock_project", observable_lock)
    try:
        locked_project = (
            await holder.execute(
                select(Project).where(Project.id == project_id).with_for_update()
            )
        ).scalar_one()

        async def blocked_generate():
            async with Session() as db:
                return await generation.generate_from_estimate(
                    db,
                    project_id=project_id,
                    user_id=actor_id,
                    client_request_id="material-needs-pg-revoke-001",
                )

        task = asyncio.create_task(blocked_generate())
        await asyncio.wait_for(reached_project_lock.wait(), timeout=10)

        # The task reached the production lock call but must remain physically
        # blocked while the revoker owns the PostgreSQL row lock.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), timeout=0.25)

        assert locked_project.contractor_id == contractor_id
        locked_project.contractor_id = None
        await holder.commit()

        with pytest.raises(HTTPException) as denied:
            await asyncio.wait_for(task, timeout=10)
        assert denied.value.status_code == 403

        assert await _count(Session, MaterialPick, MaterialPick.project_id == project_id) == 0
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == generation.SCOPE,
        ) == 0
        assert await _count(Session, DomainOutbox, *_project_outbox_filter(project_id)) == 0
    finally:
        if 'task' in locals() and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if holder.in_transaction():
            await holder.rollback()
        await holder.close()
        await engine.dispose()
