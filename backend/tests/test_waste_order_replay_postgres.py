from __future__ import annotations

import asyncio
from datetime import date
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, Room, User, UserRole, WasteOrder, WasteOrderStatus
from app.services import waste_order_service as waste_svc


def _postgres_url() -> str:
    value = os.environ.get("WASTE_ORDER_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("WASTE_ORDER_POSTGRES_URL is only set by the migrated PostgreSQL qualification job")
    assert value.startswith("postgresql+asyncpg://")
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _count(Session, model, *where) -> int:
    async with Session() as db:
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


async def _seed_create(Session, *, contractor_actor: bool = False):
    customer_id = _id("waste-customer")
    contractor_id = _id("waste-contractor")
    project_id = _id("waste-project")
    room_id = _id("waste-room")
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
                name="Waste PostgreSQL replay",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        await db.flush()
        db.add(
            Room(
                id=room_id,
                project_id=project_id,
                name="Kitchen",
                room_type="kitchen",
                length_m=4,
                width_m=3,
            )
        )
        await db.flush()
        await db.commit()
    return (contractor_id if contractor_actor else customer_id), contractor_id, project_id, room_id


async def _seed_transition(Session):
    actor_id, contractor_id, project_id, room_id = await _seed_create(
        Session,
        contractor_actor=True,
    )
    order_id = _id("waste-order")
    async with Session() as db:
        db.add(
            WasteOrder(
                id=order_id,
                project_id=project_id,
                room_id=room_id,
                volume_m3=2.5,
                waste_type="construction",
                status=WasteOrderStatus.draft,
                price=3500,
                notes="PG transition",
            )
        )
        await db.commit()
    return actor_id, contractor_id, project_id, room_id, order_id


def _payload(room_id: str) -> dict:
    return {
        "room_id": room_id,
        "volume_m3": 2.5,
        "waste_type": "construction",
        "scheduled_date": date(2026, 9, 20),
        "price": 3500.0,
        "notes": "pg-replay",
    }


@pytest.mark.asyncio
async def test_waste_order_create_same_key_postgres_race_reaches_project_lock_and_creates_one_result(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id, room_id = await _seed_create(Session)
    payload = _payload(room_id)

    original_lock = waste_svc._lock_project
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

    monkeypatch.setattr(waste_svc, "_lock_project", synchronized_lock)

    async def run_one():
        async with Session() as db:
            return await waste_svc.create_order(
                db,
                project_id=project_id,
                user_id=actor_id,
                client_request_id="waste-pg-race-001",
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
        assert await _count(Session, WasteOrder, WasteOrder.project_id == project_id) == 1
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == waste_svc.CREATE_SCOPE,
        ) == 1
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "waste_order",
        ) == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_waste_order_create_rechecks_revoked_contractor_after_physical_project_lock_wait(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id, room_id = await _seed_create(
        Session,
        contractor_actor=True,
    )
    payload = _payload(room_id)

    original_lock = waste_svc._lock_project
    lock_entered = asyncio.Event()

    async def observed_lock(db, current_project_id):
        lock_entered.set()
        return await original_lock(db, current_project_id)

    monkeypatch.setattr(waste_svc, "_lock_project", observed_lock)

    holder = Session()
    try:
        locked_project = (
            await holder.execute(select(Project).where(Project.id == project_id).with_for_update())
        ).scalar_one()
        assert locked_project.contractor_id == contractor_id

        async def blocked_create():
            async with Session() as db:
                return await waste_svc.create_order(
                    db,
                    project_id=project_id,
                    user_id=actor_id,
                    client_request_id="waste-pg-revoke-create-001",
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
        assert await _count(Session, WasteOrder, WasteOrder.project_id == project_id) == 0
        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == waste_svc.CREATE_SCOPE,
        ) == 0
    finally:
        await holder.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_waste_order_transition_rechecks_revoked_contractor_after_physical_order_lock_wait(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id, _room_id, order_id = await _seed_transition(Session)

    original_lock = waste_svc._lock_order
    lock_entered = asyncio.Event()

    async def observed_lock(db, *, project_id: str, order_id: str):
        lock_entered.set()
        return await original_lock(db, project_id=project_id, order_id=order_id)

    monkeypatch.setattr(waste_svc, "_lock_order", observed_lock)

    holder = Session()
    try:
        locked_order = (
            await holder.execute(select(WasteOrder).where(WasteOrder.id == order_id).with_for_update())
        ).scalar_one()
        assert locked_order.status == WasteOrderStatus.draft

        async def blocked_transition():
            async with Session() as db:
                stale_project = await db.get(Project, project_id)
                stale_actor = await db.get(User, actor_id)
                assert stale_project is not None
                assert stale_actor is not None
                assert stale_project.contractor_id == contractor_id
                return await waste_svc.transition_order(
                    db,
                    project=stale_project,
                    order_id=order_id,
                    actor=stale_actor,
                    target=WasteOrderStatus.requested,
                )

        task = asyncio.create_task(blocked_transition())
        await asyncio.wait_for(lock_entered.wait(), timeout=2)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), timeout=0.25)

        current_project = await holder.get(Project, project_id)
        assert current_project is not None
        current_project.contractor_id = None
        await holder.commit()

        with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
            await task

        async with Session() as db:
            assert await db.scalar(
                select(WasteOrder.status).where(WasteOrder.id == order_id)
            ) == WasteOrderStatus.draft
        assert await _count(
            Session,
            DomainOutbox,
            DomainOutbox.aggregate_type == "waste_order",
        ) == 0
    finally:
        await holder.close()
        await engine.dispose()
