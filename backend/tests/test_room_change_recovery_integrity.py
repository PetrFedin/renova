"""P0 #316: RoomChangeRequest create and decision lifecycle is replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.room_change_creation_integrity import (
    RoomChangeCreateCommand,
    create_room_change_request_integrity,
)
from app.api.v1.room_requests import approve_request, reject_request
from app.api.v1.router import api_router
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, Room, RoomChangeLog, RoomChangeRequest, User, UserRole

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008501", role=UserRole.customer, full_name="Room customer")
    contractor = User(phone="+79990008502", role=UserRole.contractor, full_name="Room contractor")
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name="Room change replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.flush()
    room = Room(
        project_id=project.id,
        name="Кухня",
        room_type="kitchen",
        length_m=4.0,
        width_m=3.0,
        height_m=2.7,
    )
    db.add(room)
    await db.commit()
    return customer, contractor, project, room


async def test_room_change_create_response_loss_replay_and_approve_once(db):
    customer, contractor, project, room = await _fixture(db)
    body = RoomChangeCreateCommand(
        room_id=room.id,
        message="Переименовать комнату",
        payload={"name": "Кухня-гостиная"},
        client_request_id="room-change-response-loss-0001",
    )

    first = await create_room_change_request_integrity(project.id, body, customer, db)
    replay = await create_room_change_request_integrity(project.id, body, customer, db)
    assert replay["id"] == first["id"]
    assert first["replayed"] is False
    assert replay["replayed"] is True

    request_count = await db.scalar(
        select(func.count()).select_from(RoomChangeRequest).where(RoomChangeRequest.project_id == project.id)
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "room_change.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert request_count == 1
    assert ledger_count == 1

    approved = await approve_request(project.id, first["id"], user=contractor, db=db)
    approved_replay = await approve_request(project.id, first["id"], user=contractor, db=db)
    assert approved["replayed"] is False
    assert approved_replay["replayed"] is True
    assert approved["status"] == "approved"
    assert approved_replay["changes"] == {}

    refreshed_room = await db.get(Room, room.id)
    assert refreshed_room is not None
    assert refreshed_room.name == "Кухня-гостиная"
    change_log_count = await db.scalar(
        select(func.count()).select_from(RoomChangeLog).where(
            RoomChangeLog.room_id == room.id,
            RoomChangeLog.field_name == "name",
        )
    )
    assert change_log_count == 1, "approved replay must not apply/audit the room patch twice"

    with pytest.raises(HTTPException) as exc_info:
        await reject_request(project.id, first["id"], user=contractor, db=db)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "room_change_final_state_conflict"


async def test_room_change_same_request_id_different_payload_conflicts(db):
    customer, _, project, room = await _fixture(db)
    request_id = "room-change-conflict-0001"
    await create_room_change_request_integrity(
        project.id,
        RoomChangeCreateCommand(
            room_id=room.id,
            message="Первый запрос",
            payload={"name": "Кухня 1"},
            client_request_id=request_id,
        ),
        customer,
        db,
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_room_change_request_integrity(
            project.id,
            RoomChangeCreateCommand(
                room_id=room.id,
                message="Другой запрос",
                payload={"name": "Кухня 2"},
                client_request_id=request_id,
            ),
            customer,
            db,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"


def test_room_change_create_runtime_has_one_canonical_handler():
    path = "/api/v1/projects/{project_id}/room-change-requests"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("room_change_creation_integrity")
