from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import floor_plans as api
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, FloorPlan, FurnitureItem, Project, Room, User, UserRole
from app.services import furniture_create_service as furniture_create
from app.services.client_write_idempotency import IdempotencyConflict


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _seed(db):
    customer = User(
        id=_id("furniture-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    project = Project(
        id=_id("furniture-project"),
        name="Furniture replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    room = Room(
        id=_id("furniture-room"),
        project_id=project.id,
        name="Living room",
        room_type="living",
        length_m=4,
        width_m=3,
    )
    plan = FloorPlan(
        id=_id("furniture-plan"),
        project_id=project.id,
        name="Plan",
        image_key="tests/furniture-plan.png",
    )
    db.add_all([customer, project, room, plan])
    await db.commit()
    return customer, project, room, plan


async def _count(db, model, *where) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def _payload(room_id: str, plan_id: str, *, name: str = "Sofa") -> dict:
    return {
        "room_id": room_id,
        "floor_plan_id": plan_id,
        "name": name,
        "width_m": 2.1,
        "depth_m": 0.9,
        "height_m": 0.8,
        "x_pct": 30,
        "y_pct": 60,
        "notes": "replay-test",
    }


@pytest.mark.asyncio
async def test_furniture_create_replays_original_conflicts_on_changed_payload_and_preserves_distinct_intents(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer, project, room, plan = await _seed(db)
    payload = _payload(room.id, plan.id)

    first, replayed = await furniture_create.create_furniture(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="furniture-response-loss-001",
        payload=payload,
    )
    first_id = first.id
    assert replayed is False

    same, replayed = await furniture_create.create_furniture(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="furniture-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert same.id == first_id

    with pytest.raises(IdempotencyConflict):
        await furniture_create.create_furniture(
            db,
            project_id=project.id,
            user_id=customer.id,
            client_request_id="furniture-response-loss-001",
            payload=_payload(room.id, plan.id, name="Changed sofa"),
        )

    second, replayed = await furniture_create.create_furniture(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="furniture-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert second.id != first_id

    assert await _count(db, FurnitureItem, FurnitureItem.project_id == project.id) == 2
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == furniture_create.SCOPE,
    ) == 2
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "furniture",
        DomainOutbox.payload_json.contains(project.id),
    ) == 2

    with pytest.raises(HTTPException) as route_conflict:
        await api.create_furniture(
            project.id,
            api.FurnitureCreateIn(
                **_payload(room.id, plan.id, name="Route conflict"),
                client_request_id="furniture-response-loss-001",
            ),
            user=customer,
            db=db,
        )
    assert route_conflict.value.status_code == 409


@pytest.mark.asyncio
async def test_furniture_create_rolls_back_flushed_item_outbox_and_ledger_then_same_intent_recovers(db, monkeypatch):
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer, project, room, plan = await _seed(db)
    payload = _payload(room.id, plan.id)
    original_enqueue = furniture_create.outbox.enqueue

    async def fail_after_item_flush(*_args, **_kwargs):
        raise RuntimeError("synthetic_outbox_prepare_failure")

    monkeypatch.setattr(furniture_create.outbox, "enqueue", fail_after_item_flush)
    with pytest.raises(RuntimeError, match="synthetic_outbox_prepare_failure"):
        await furniture_create.create_furniture(
            db,
            project_id=project.id,
            user_id=customer.id,
            client_request_id="furniture-rollback-001",
            payload=payload,
        )

    assert await _count(db, FurnitureItem, FurnitureItem.project_id == project.id) == 0
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == furniture_create.SCOPE,
    ) == 0
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "furniture",
        DomainOutbox.payload_json.contains(project.id),
    ) == 0

    monkeypatch.setattr(furniture_create.outbox, "enqueue", original_enqueue)
    recovered, replayed = await furniture_create.create_furniture(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="furniture-rollback-001",
        payload=payload,
    )
    assert replayed is False
    assert recovered.project_id == project.id
    assert await _count(db, FurnitureItem, FurnitureItem.project_id == project.id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == furniture_create.SCOPE,
    ) == 1
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "furniture",
        DomainOutbox.payload_json.contains(project.id),
    ) == 1
