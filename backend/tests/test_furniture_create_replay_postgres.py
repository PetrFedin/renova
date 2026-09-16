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
from app.models.entities import DomainOutbox, FloorPlan, FurnitureItem, Project, Room, User, UserRole
from app.services import furniture_create_service as furniture_create


def _postgres_url() -> str:
    value = os.environ.get("FURNITURE_CREATE_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("FURNITURE_CREATE_POSTGRES_URL is only set by the migrated PostgreSQL qualification job")
    assert value.startswith("postgresql+asyncpg://")
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _seed(Session, *, contractor_actor: bool = False):
    customer_id = _id("furniture-customer")
    contractor_id = _id("furniture-contractor")
    project_id = _id("furniture-project")
    room_id = _id("furniture-room")
    plan_id = _id("furniture-plan")
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
                name="Furniture PostgreSQL replay",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        await db.flush()
        db.add_all(
            [
                Room(
                    id=room_id,
                    project_id=project_id,
                    name="Living room",
                    room_type="living",
                    length_m=4,
                    width_m=3,
                ),
                FloorPlan(
                    id=plan_id,
                    project_id=project_id,
                    name="Plan",
                    image_key="tests/furniture-pg.png",
                ),
            ]
        )
        await db.flush()
        await db.commit()
    return (contractor_id if contractor_actor else customer_id), contractor_id, project_id, room_id, plan_id


async def _count(Session, model, *where) -> int:
    async with Session() as db:
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def _payload(room_id: str, plan_id: str) -> dict:
    return {
        "room_id": room_id,
        "floor_plan_id": plan_id,
        "name": "Sofa",
        "width_m": 2.1,
        "depth_m": 0.9,
        "height_m": 0.8,
        "x_pct": 30,
        "y_pct": 60,
        "notes": "pg-replay",
    }


def _outbox_filter(project_id: str):
    return (
        DomainOutbox.aggregate_type == "furniture",
        DomainOutbox.payload_json.contains(project_id),
    )


@pytest.mark.asyncio
async def test_furniture_create_same_key_postgres_race_reaches_project_lock_and_creates_one_result(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id, room_id, plan_id = await _seed(Session)
    payload = _payload(room_id, plan_id)

    original_lock = furniture_create._lock_project
    both_ready = asyncio.Event()
    release = asyncio.Event()
    entered = 0

    async def synchronized_lock(db, current_project_id):
        nonlocal entered
        entered += 1
        if entered == 2:
            both_ready.set()
        await release.wait()
        return await original_lock(db, current_project_id)

    monkeypatch.setattr(furniture_create, "_lock_project", synchronized_lock)

    async def run_one():
        async with Session() as db:
            return await furniture_create.create_furniture(
                db,
                project_id=project_id,
                user_id=actor_id,
                client_request_id="furniture-pg-race-001",
                payload=payload,
            )

    try:
        first_task = asyncio.create_task(run_one())
        second_task = asyncio.create_task(run_one())
        await asyncio.wait_for(both_ready.wait(), timeout=2)
        assert not first_task.done()
        assert not second_task.done()
        release.set()
        first, second = await asyncio.gather(first_task, second_task)

        ids = {first[0].id, second[0].id}
        assert len(ids) == 1
        assert sorted([first[1], second[1]]) == [False, True]
        assert await _count(Session, FurnitureItem, FurnitureItem.project_id == project_id) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == furniture_create.SCOPE,
        ) == 1
        assert await _count(Session, DomainOutbox, *_outbox_filter(project_id)) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_furniture_create_rechecks_revoked_contractor_after_physical_project_lock_wait(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id, room_id, plan_id = await _seed(Session, contractor_actor=True)
    payload = _payload(room_id, plan_id)

    original_lock = furniture_create._lock_project
    lock_entered = asyncio.Event()

    async def observed_lock(db, current_project_id):
        lock_entered.set()
        return await original_lock(db, current_project_id)

    monkeypatch.setattr(furniture_create, "_lock_project", observed_lock)

    holder = Session()
    try:
        locked_project = (
            await holder.execute(select(Project).where(Project.id == project_id).with_for_update())
        ).scalar_one()
        assert locked_project.contractor_id == contractor_id

        async def blocked_create():
            async with Session() as db:
                return await furniture_create.create_furniture(
                    db,
                    project_id=project_id,
                    user_id=actor_id,
                    client_request_id="furniture-pg-revoke-001",
                    payload=payload,
                )

        task = asyncio.create_task(blocked_create())
        await asyncio.wait_for(lock_entered.wait(), timeout=2)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), timeout=0.25)

        locked_project.contractor_id = None
        await holder.commit()

        with pytest.raises(HTTPException) as denied:
            await task
        assert denied.value.status_code == 403

        assert await _count(Session, FurnitureItem, FurnitureItem.project_id == project_id) == 0
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == furniture_create.SCOPE,
        ) == 0
        assert await _count(Session, DomainOutbox, *_outbox_filter(project_id)) == 0
    finally:
        await holder.close()
        await engine.dispose()
