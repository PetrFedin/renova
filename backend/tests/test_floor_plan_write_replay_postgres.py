from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, FloorPlan, FloorPlanPin, Project, Room, Stage, User, UserRole
from app.services import accept_orchestrator
from app.services import floor_plan_write_service as floor_write


def _postgres_url() -> str:
    value = os.environ.get("FLOOR_WRITE_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("FLOOR_WRITE_POSTGRES_URL is only set by the migrated PostgreSQL qualification job")
    assert value.startswith("postgresql+asyncpg://")
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _count(Session, model, *where) -> int:
    async with Session() as db:
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


async def _seed_project(Session, *, contractor_actor: bool = False):
    customer_id = _id("floor-customer")
    contractor_id = _id("floor-contractor")
    project_id = _id("floor-project")
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
                name="Floor PostgreSQL replay",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        await db.flush()
        await db.commit()
    return (contractor_id if contractor_actor else customer_id), contractor_id, project_id


async def _seed_pin(Session):
    actor_id, contractor_id, project_id = await _seed_project(Session)
    room_id = _id("floor-room")
    plan_id = _id("floor-plan")
    async with Session() as db:
        db.add_all(
            [
                Room(
                    id=room_id,
                    project_id=project_id,
                    name="Kitchen",
                    room_type="kitchen",
                    length_m=4,
                    width_m=3,
                ),
                FloorPlan(
                    id=plan_id,
                    project_id=project_id,
                    name="Floor plan",
                    image_key="plans/floor-pg.png",
                ),
            ]
        )
        await db.flush()
        await db.commit()
    return actor_id, contractor_id, project_id, room_id, plan_id


def _plan_payload() -> dict:
    return {
        "name": "Этаж 1",
        "floor_level": 1,
        "image_key": "plans/floor-1.jpg",
        "width_px": 1600,
        "height_px": 1200,
    }


def _pin_payload(room_id: str) -> dict:
    return {"room_id": room_id, "x_pct": 30, "y_pct": 60, "label": "Кухня"}


@pytest.mark.asyncio
async def test_floor_plan_create_same_key_postgres_race_reaches_project_lock_and_creates_one_result(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id = await _seed_project(Session)
    payload = _plan_payload()

    original_lock = floor_write._lock_project
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

    monkeypatch.setattr(floor_write, "_lock_project", synchronized_lock)

    async def run_one():
        async with Session() as db:
            return await floor_write.create_plan(
                db,
                project_id=project_id,
                user_id=actor_id,
                client_request_id="floor-plan-pg-race-001",
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

        assert {first[0].id} == {second[0].id}
        assert sorted([first[1], second[1]]) == [False, True]
        assert await _count(Session, FloorPlan, FloorPlan.project_id == project_id) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == floor_write.PLAN_SCOPE,
        ) == 1
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "floor_plan",
            DomainOutbox.payload_json.contains(project_id),
        ) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_floor_plan_create_rechecks_revoked_contractor_after_physical_project_lock_wait(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id = await _seed_project(Session, contractor_actor=True)

    original_lock = floor_write._lock_project
    lock_entered = asyncio.Event()

    async def observed_lock(db, current_project_id):
        lock_entered.set()
        return await original_lock(db, current_project_id)

    monkeypatch.setattr(floor_write, "_lock_project", observed_lock)
    holder = Session()
    try:
        locked_project = (
            await holder.execute(select(Project).where(Project.id == project_id).with_for_update())
        ).scalar_one()
        assert locked_project.contractor_id == contractor_id

        async def blocked_create():
            async with Session() as db:
                return await floor_write.create_plan(
                    db,
                    project_id=project_id,
                    user_id=actor_id,
                    client_request_id="floor-plan-pg-revoke-001",
                    payload=_plan_payload(),
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
        assert await _count(Session, FloorPlan, FloorPlan.project_id == project_id) == 0
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == floor_write.PLAN_SCOPE,
        ) == 0
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "floor_plan",
            DomainOutbox.payload_json.contains(project_id),
        ) == 0
    finally:
        await holder.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_floor_pin_distinct_intents_postgres_race_serializes_to_one_pin(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id, room_id, plan_id = await _seed_pin(Session)
    payload = _pin_payload(room_id)

    original_lock = floor_write._lock_project
    both_ready = asyncio.Event()
    release = asyncio.Event()
    entered = 0

    async def synchronized_project_lock(db, current_project_id):
        nonlocal entered
        entered += 1
        if entered == 2:
            both_ready.set()
        await release.wait()
        return await original_lock(db, current_project_id)

    monkeypatch.setattr(floor_write, "_lock_project", synchronized_project_lock)

    async def run_one(request_id: str):
        async with Session() as db:
            return await floor_write.upsert_pin(
                db,
                project_id=project_id,
                plan_id=plan_id,
                user_id=actor_id,
                client_request_id=request_id,
                payload=payload,
            )

    try:
        first_task = asyncio.create_task(run_one("floor-pin-pg-race-001"))
        second_task = asyncio.create_task(run_one("floor-pin-pg-race-002"))
        await asyncio.wait_for(both_ready.wait(), timeout=2)
        assert not first_task.done()
        assert not second_task.done()
        release.set()
        first, second = await asyncio.gather(first_task, second_task)

        assert first[1] is False
        assert second[1] is False
        assert first[0].id == second[0].id
        assert await _count(
            Session,
            FloorPlanPin,
            FloorPlanPin.floor_plan_id == plan_id,
            FloorPlanPin.room_id == room_id,
        ) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == floor_write.PIN_SCOPE,
        ) == 2
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "floor_plan_pin",
            DomainOutbox.payload_json.contains(project_id),
        ) == 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_floor_pin_api_and_acceptance_share_physical_floor_plan_lock_and_leave_one_pin(monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id, room_id, plan_id = await _seed_pin(Session)

    api_lock_entered = asyncio.Event()
    original_plan_lock = floor_write.lock_floor_plan

    async def observed_plan_lock(db, *, project_id: str, plan_id: str):
        api_lock_entered.set()
        return await original_plan_lock(db, project_id=project_id, plan_id=plan_id)

    monkeypatch.setattr(floor_write, "lock_floor_plan", observed_plan_lock)
    holder = Session()
    try:
        locked_plan = (
            await holder.execute(select(FloorPlan).where(FloorPlan.id == plan_id).with_for_update())
        ).scalar_one()
        assert locked_plan.project_id == project_id

        async def api_write():
            async with Session() as db:
                return await floor_write.upsert_pin(
                    db,
                    project_id=project_id,
                    plan_id=plan_id,
                    user_id=actor_id,
                    client_request_id="floor-pin-api-acceptance-001",
                    payload=_pin_payload(room_id),
                )

        async def acceptance_write():
            async with Session() as db:
                transient_stage = Stage(
                    id=_id("floor-stage"),
                    project_id=project_id,
                    name="Плитка",
                    room_ids_json=json.dumps([room_id]),
                )
                await accept_orchestrator.mark_acceptance_pin_on_plan(
                    db,
                    project_id=project_id,
                    stage=transient_stage,
                    acceptance_room_id=room_id,
                )
                await db.commit()

        api_task = asyncio.create_task(api_write())
        acceptance_task = asyncio.create_task(acceptance_write())
        await asyncio.wait_for(api_lock_entered.wait(), timeout=2)
        await asyncio.sleep(0.1)
        assert not api_task.done()
        assert not acceptance_task.done()

        await holder.commit()
        api_result, _ = await asyncio.gather(api_task, acceptance_task)
        assert api_result[0].id

        assert await _count(
            Session,
            FloorPlanPin,
            FloorPlanPin.floor_plan_id == plan_id,
            FloorPlanPin.room_id == room_id,
        ) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == floor_write.PIN_SCOPE,
        ) == 1
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "floor_plan_pin",
            DomainOutbox.payload_json.contains(project_id),
        ) == 1
    finally:
        await holder.close()
        await engine.dispose()
