from __future__ import annotations

from datetime import date
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import waste_orders as api
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, Room, User, UserRole, WasteOrder
from app.services import waste_order_service as waste_svc
from app.services.client_write_idempotency import IdempotencyConflict


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _seed(db):
    customer = User(
        id=_id("waste-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    project = Project(
        id=_id("waste-project"),
        name="Waste replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    foreign_project = Project(
        id=_id("waste-foreign-project"),
        name="Foreign waste project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(customer)
    await db.flush()
    db.add_all([project, foreign_project])
    await db.flush()
    room = Room(
        id=_id("waste-room"),
        project_id=project.id,
        name="Kitchen",
        room_type="kitchen",
        length_m=4,
        width_m=3,
    )
    foreign_room = Room(
        id=_id("waste-foreign-room"),
        project_id=foreign_project.id,
        name="Foreign room",
        room_type="living",
        length_m=5,
        width_m=4,
    )
    db.add_all([room, foreign_room])
    await db.commit()
    return customer, project, room, foreign_room


async def _count(db, model, *where) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def _payload(room_id: str, *, notes: str = "После демонтажа") -> dict:
    return {
        "room_id": room_id,
        "volume_m3": 2.5,
        "waste_type": "construction",
        "scheduled_date": date(2026, 9, 20),
        "price": 3500.0,
        "notes": notes,
    }


@pytest.mark.asyncio
async def test_waste_order_create_replays_original_conflicts_changed_payload_preserves_distinct_intents_and_rejects_foreign_room(db):
    customer, project, room, foreign_room = await _seed(db)
    customer_id = customer.id
    project_id = project.id
    room_id = room.id
    foreign_room_id = foreign_room.id
    payload = _payload(room_id)

    first, replayed = await waste_svc.create_order(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="waste-response-loss-001",
        payload=payload,
    )
    first_id = first.id
    assert replayed is False

    same, replayed = await waste_svc.create_order(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="waste-response-loss-001",
        payload=payload,
    )
    assert replayed is True
    assert same.id == first_id

    with pytest.raises(IdempotencyConflict):
        await waste_svc.create_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="waste-response-loss-001",
            payload=_payload(room_id, notes="Changed payload"),
        )

    second, replayed = await waste_svc.create_order(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="waste-response-loss-002",
        payload=payload,
    )
    assert replayed is False
    assert second.id != first_id

    with pytest.raises(HTTPException) as foreign_reference:
        await waste_svc.create_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="waste-foreign-room-001",
            payload=_payload(foreign_room_id),
        )
    assert foreign_reference.value.status_code == 404

    assert await _count(db, WasteOrder, WasteOrder.project_id == project_id) == 2
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == waste_svc.CREATE_SCOPE,
    ) == 2
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "waste_order",
    ) == 0

    fresh_customer = await db.get(User, customer_id, populate_existing=True)
    assert fresh_customer is not None
    with pytest.raises(HTTPException) as route_conflict:
        await api.create_waste(
            project_id,
            api.WasteCreateIn(
                **_payload(room_id, notes="Route conflict"),
                client_request_id="waste-response-loss-001",
            ),
            user=fresh_customer,
            db=db,
        )
    assert route_conflict.value.status_code == 409
    assert route_conflict.value.detail["code"] == "idempotency_conflict"


@pytest.mark.asyncio
async def test_waste_order_create_rolls_back_flushed_order_and_ledger_then_same_intent_recovers(db, monkeypatch):
    customer, project, room, _foreign_room = await _seed(db)
    customer_id = customer.id
    project_id = project.id
    room_id = room.id
    payload = _payload(room_id)
    original_commit = waste_svc.commit_client_write

    async def fail_after_order_flush(*_args, **_kwargs):
        raise RuntimeError("synthetic_waste_ledger_failure")

    monkeypatch.setattr(waste_svc, "commit_client_write", fail_after_order_flush)
    with pytest.raises(RuntimeError, match="synthetic_waste_ledger_failure"):
        await waste_svc.create_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="waste-rollback-001",
            payload=payload,
        )

    assert await _count(db, WasteOrder, WasteOrder.project_id == project_id) == 0
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == waste_svc.CREATE_SCOPE,
    ) == 0
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == "waste_order",
    ) == 0

    monkeypatch.setattr(waste_svc, "commit_client_write", original_commit)
    recovered, replayed = await waste_svc.create_order(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="waste-rollback-001",
        payload=payload,
    )
    assert replayed is False
    assert recovered.id
    assert await _count(db, WasteOrder, WasteOrder.project_id == project_id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.scope == waste_svc.CREATE_SCOPE,
    ) == 1
