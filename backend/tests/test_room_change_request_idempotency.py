from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    DomainOutbox,
    Project,
    RoomChangeRequest,
    User,
    UserRole,
)
from app.services import room_change_service
from app.services import room_mutation_service
from app.services.client_write_idempotency import IdempotencyConflict


def room_payload() -> dict:
    return {
        "name": "Гостиная",
        "room_type": "living",
        "floor_level": 1,
        "length_m": 4,
        "width_m": 3,
        "height_m": 2.7,
        "openings_sq_m": 2,
        "outlets_count": 2,
        "switches_count": 1,
        "plumbing_points": 0,
        "notes": None,
        "budget_alert_pct": None,
    }


@pytest.mark.asyncio
async def test_room_change_create_replays_same_intent_and_preserves_distinct_intents(db):
    customer = User(
        id="room-change-idem-customer",
        phone="+78030000001",
        role=UserRole.customer,
    )
    contractor = User(
        id="room-change-idem-contractor",
        phone="+78030000002",
        role=UserRole.contractor,
    )
    project = Project(
        id="room-change-idem-project",
        name="Room change idempotency",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()

    created_room = await room_mutation_service.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id="room-change-seed-room-0001",
    )
    room_id = created_room.room.id
    request_id = "room-change-intent-0001"
    payload = {"width_m": 5, "outlets_count": 4}

    first, first_replayed = await room_change_service.create_request(
        db,
        project=project,
        actor=customer,
        room_id=room_id,
        message="Увеличить ширину и число розеток",
        payload=payload,
        client_request_id=request_id,
    )
    second, second_replayed = await room_change_service.create_request(
        db,
        project=project,
        actor=customer,
        room_id=room_id,
        message="Увеличить ширину и число розеток",
        payload=payload,
        client_request_id=request_id,
    )

    assert first_replayed is False
    assert second_replayed is True
    assert second.id == first.id
    assert await db.scalar(
        select(func.count())
        .select_from(RoomChangeRequest)
        .where(RoomChangeRequest.project_id == project.id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.scope == room_change_service.ROOM_CHANGE_CREATE_SCOPE,
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.request_id == request_id,
        )
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "room_change_request",
            DomainOutbox.aggregate_id == first.id,
        )
    ) == 2

    with pytest.raises(IdempotencyConflict):
        await room_change_service.create_request(
            db,
            project=project,
            actor=customer,
            room_id=room_id,
            message="Тот же id, но другой смысл",
            payload=payload,
            client_request_id=request_id,
        )

    deliberate_second, deliberate_second_replayed = await room_change_service.create_request(
        db,
        project=project,
        actor=customer,
        room_id=room_id,
        message="Увеличить ширину и число розеток",
        payload=payload,
        client_request_id="room-change-intent-0002",
    )
    assert deliberate_second_replayed is False
    assert deliberate_second.id != first.id
    assert await db.scalar(
        select(func.count())
        .select_from(RoomChangeRequest)
        .where(RoomChangeRequest.project_id == project.id)
    ) == 2
