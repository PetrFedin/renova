from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import floor_plans as api
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, FloorPlan, FloorPlanPin, Project, Room, User, UserRole
from app.services import floor_plan_write_service as floor_write
from app.services.client_write_idempotency import IdempotencyConflict


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _count(db, model, *where) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


async def _seed_project(db) -> tuple[str, str]:
    customer = User(
        id=_id("floor-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    customer_id = customer.id
    project = Project(
        id=_id("floor-project"),
        name="Floor write replay",
        renovation_type="cosmetic",
        customer_id=customer_id,
    )
    project_id = project.id
    db.add(customer)
    await db.flush()
    db.add(project)
    await db.commit()
    return customer_id, project_id


async def _seed_pin(db) -> tuple[str, str, str, str, str]:
    customer_id, project_id = await _seed_project(db)
    foreign_project = Project(
        id=_id("floor-foreign-project"),
        name="Foreign floor project",
        renovation_type="cosmetic",
        customer_id=customer_id,
    )
    foreign_project_id = foreign_project.id
    db.add(foreign_project)
    await db.flush()
    room = Room(
        id=_id("floor-room"),
        project_id=project_id,
        name="Kitchen",
        room_type="kitchen",
        length_m=4,
        width_m=3,
    )
    room_id = room.id
    foreign_room = Room(
        id=_id("floor-foreign-room"),
        project_id=foreign_project_id,
        name="Foreign room",
        room_type="living",
        length_m=5,
        width_m=4,
    )
    foreign_room_id = foreign_room.id
    plan = FloorPlan(
        id=_id("floor-plan"),
        project_id=project_id,
        name="Plan",
        image_key="plans/replay.png",
    )
    plan_id = plan.id
    db.add_all([room, foreign_room, plan])
    await db.commit()
    return customer_id, project_id, plan_id, room_id, foreign_room_id


def _plan_payload(*, name: str = "Этаж 1") -> dict:
    return {
        "name": name,
        "floor_level": 1,
        "image_key": "plans/floor-1.jpg",
        "width_px": 1600,
        "height_px": 1200,
    }


def _pin_payload(room_id: str, *, x_pct: float = 30, label: str | None = "Кухня") -> dict:
    return {
        "room_id": room_id,
        "x_pct": x_pct,
        "y_pct": 60,
        "label": label,
    }


@pytest.mark.asyncio
async def test_floor_plan_create_replays_conflicts_preserves_distinct_intents_and_one_activity_each(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer_id, project_id = await _seed_project(db)
    payload = _plan_payload()

    first, replayed = await floor_write.create_plan(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="floor-plan-response-loss-001",
        payload=payload,
    )
    first_id = first.id
    assert replayed is False

    same, replayed = await floor_write.create_plan(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="floor-plan-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert same.id == first_id

    with pytest.raises(IdempotencyConflict):
        await floor_write.create_plan(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="floor-plan-response-loss-001",
            payload=_plan_payload(name="Changed plan"),
        )

    second, replayed = await floor_write.create_plan(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="floor-plan-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert second.id != first_id

    assert await _count(db, FloorPlan, FloorPlan.project_id == project_id) == 2
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PLAN_SCOPE,
    ) == 2
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "floor_plan",
        DomainOutbox.payload_json.contains(project_id),
    ) == 2

    actor = await db.get(User, customer_id, populate_existing=True)
    assert actor is not None
    with pytest.raises(HTTPException) as route_conflict:
        await api.create_plan(
            project_id,
            api.PlanCreateIn(
                **_plan_payload(name="Route conflict"),
                client_request_id="floor-plan-response-loss-001",
            ),
            user=actor,
            db=db,
        )
    assert route_conflict.value.status_code == 409
    assert route_conflict.value.detail["code"] == "idempotency_conflict"


@pytest.mark.asyncio
async def test_floor_plan_create_rolls_back_plan_activity_and_ledger_then_same_intent_recovers(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer_id, project_id = await _seed_project(db)
    payload = _plan_payload()
    original_enqueue = floor_write.outbox.enqueue

    async def fail_after_plan_flush(*_args, **_kwargs):
        raise RuntimeError("synthetic_floor_plan_outbox_failure")

    monkeypatch.setattr(floor_write.outbox, "enqueue", fail_after_plan_flush)
    with pytest.raises(RuntimeError, match="synthetic_floor_plan_outbox_failure"):
        await floor_write.create_plan(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="floor-plan-rollback-001",
            payload=payload,
        )

    assert await _count(db, FloorPlan, FloorPlan.project_id == project_id) == 0
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PLAN_SCOPE,
    ) == 0
    assert await _count(db, DomainOutbox, DomainOutbox.aggregate_type == "floor_plan") == 0

    monkeypatch.setattr(floor_write.outbox, "enqueue", original_enqueue)
    recovered, replayed = await floor_write.create_plan(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="floor-plan-rollback-001",
        payload=payload,
    )
    assert replayed is False
    assert recovered.id
    assert await _count(db, FloorPlan, FloorPlan.project_id == project_id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PLAN_SCOPE,
    ) == 1
    assert await _count(db, DomainOutbox, DomainOutbox.aggregate_type == "floor_plan") == 1


@pytest.mark.asyncio
async def test_floor_pin_upsert_replays_without_duplicate_activity_conflicts_and_rejects_foreign_room(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer_id, project_id, plan_id, room_id, foreign_room_id = await _seed_pin(db)
    payload = _pin_payload(room_id)

    first, replayed = await floor_write.upsert_pin(
        db,
        project_id=project_id,
        plan_id=plan_id,
        user_id=customer_id,
        client_request_id="floor-pin-response-loss-001",
        payload=payload,
    )
    first_id = first.id
    assert replayed is False

    same, replayed = await floor_write.upsert_pin(
        db,
        project_id=project_id,
        plan_id=plan_id,
        user_id=customer_id,
        client_request_id="floor-pin-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert same.id == first_id

    with pytest.raises(IdempotencyConflict):
        await floor_write.upsert_pin(
            db,
            project_id=project_id,
            plan_id=plan_id,
            user_id=customer_id,
            client_request_id="floor-pin-response-loss-001",
            payload=_pin_payload(room_id, x_pct=45),
        )

    deliberate, replayed = await floor_write.upsert_pin(
        db,
        project_id=project_id,
        plan_id=plan_id,
        user_id=customer_id,
        client_request_id="floor-pin-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert deliberate.id == first_id

    with pytest.raises(HTTPException) as foreign_reference:
        await floor_write.upsert_pin(
            db,
            project_id=project_id,
            plan_id=plan_id,
            user_id=customer_id,
            client_request_id="floor-pin-foreign-room-001",
            payload=_pin_payload(foreign_room_id),
        )
    assert foreign_reference.value.status_code == 404

    assert await _count(
        db,
        FloorPlanPin,
        FloorPlanPin.floor_plan_id == plan_id,
        FloorPlanPin.room_id == room_id,
    ) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PIN_SCOPE,
    ) == 2
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "floor_plan_pin",
        DomainOutbox.payload_json.contains(project_id),
    ) == 2

    actor = await db.get(User, customer_id, populate_existing=True)
    assert actor is not None
    with pytest.raises(HTTPException) as route_conflict:
        await api.upsert_pin(
            project_id,
            plan_id,
            api.PinCreateIn(
                **_pin_payload(room_id, label="Changed route payload"),
                client_request_id="floor-pin-response-loss-001",
            ),
            user=actor,
            db=db,
        )
    assert route_conflict.value.status_code == 409
    assert route_conflict.value.detail["code"] == "idempotency_conflict"


@pytest.mark.asyncio
async def test_floor_pin_upsert_rolls_back_flushed_pin_activity_and_ledger_then_same_intent_recovers(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer_id, project_id, plan_id, room_id, _foreign_room_id = await _seed_pin(db)
    payload = _pin_payload(room_id)
    original_enqueue = floor_write.outbox.enqueue

    async def fail_after_pin_flush(*_args, **_kwargs):
        raise RuntimeError("synthetic_floor_pin_outbox_failure")

    monkeypatch.setattr(floor_write.outbox, "enqueue", fail_after_pin_flush)
    with pytest.raises(RuntimeError, match="synthetic_floor_pin_outbox_failure"):
        await floor_write.upsert_pin(
            db,
            project_id=project_id,
            plan_id=plan_id,
            user_id=customer_id,
            client_request_id="floor-pin-rollback-001",
            payload=payload,
        )

    assert await _count(db, FloorPlanPin, FloorPlanPin.floor_plan_id == plan_id) == 0
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PIN_SCOPE,
    ) == 0
    assert await _count(db, DomainOutbox, DomainOutbox.aggregate_type == "floor_plan_pin") == 0

    monkeypatch.setattr(floor_write.outbox, "enqueue", original_enqueue)
    recovered, replayed = await floor_write.upsert_pin(
        db,
        project_id=project_id,
        plan_id=plan_id,
        user_id=customer_id,
        client_request_id="floor-pin-rollback-001",
        payload=payload,
    )
    assert replayed is False
    assert recovered.id
    assert await _count(db, FloorPlanPin, FloorPlanPin.floor_plan_id == plan_id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == floor_write.PIN_SCOPE,
    ) == 1
    assert await _count(db, DomainOutbox, DomainOutbox.aggregate_type == "floor_plan_pin") == 1
