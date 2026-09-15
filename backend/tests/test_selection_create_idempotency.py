"""P0 #316: selection create is atomic and replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.selections import SelectionIn, create_selection
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, Room, SelectionItem, User, UserRole
from app.services import outbox_inline_dispatch

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(
        phone="+79990004101",
        role=UserRole.customer,
        full_name="Selection customer",
    )
    outsider = User(
        phone="+79990004102",
        role=UserRole.customer,
        full_name="Selection outsider",
    )
    db.add_all([customer, outsider])
    await db.flush()
    project = Project(
        name="Selection project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    foreign_project = Project(
        name="Foreign selection project",
        renovation_type="cosmetic",
        customer_id=outsider.id,
    )
    db.add_all([project, foreign_project])
    await db.flush()
    room = Room(project_id=project.id, name="Kitchen", room_type="kitchen")
    foreign_room = Room(project_id=foreign_project.id, name="Foreign", room_type="other")
    db.add_all([room, foreign_room])
    await db.commit()
    return customer, project, room, foreign_room


async def _no_dispatch(*_args, **_kwargs):
    return None


async def test_selection_response_loss_replay_creates_one_entity_and_one_activity(db, monkeypatch):
    customer, project, room, _ = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    body = SelectionIn(
        title="Керамогранит",
        room_id=room.id,
        category="tile",
        sku="TILE-01",
        allowance=15000,
        price=12400,
        client_request_id="selection-response-loss-0001",
    )

    first = await create_selection(project.id, body, customer, db)
    assert first["idempotent_replay"] is False

    replay = await create_selection(project.id, body, customer, db)
    assert replay["id"] == first["id"]
    assert replay["idempotent_replay"] is True

    entity_count = await db.scalar(
        select(func.count()).select_from(SelectionItem).where(SelectionItem.project_id == project.id)
    )
    assert entity_count == 1
    request_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "selection.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert request_count == 1
    outbox_count = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "selection",
            DomainOutbox.aggregate_id == first["id"],
        )
    )
    assert outbox_count == 1


async def test_selection_same_request_id_different_payload_conflicts(db, monkeypatch):
    customer, project, room, _ = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    request_id = "selection-conflict-0001"
    first = SelectionIn(
        title="Смеситель",
        room_id=room.id,
        category="plumbing",
        price=12000,
        client_request_id=request_id,
    )
    await create_selection(project.id, first, customer, db)

    changed = SelectionIn(
        title="Смеситель другой",
        room_id=room.id,
        category="plumbing",
        price=12000,
        client_request_id=request_id,
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_selection(project.id, changed, customer, db)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    entity_count = await db.scalar(
        select(func.count()).select_from(SelectionItem).where(SelectionItem.project_id == project.id)
    )
    assert entity_count == 1


async def test_selection_rejects_foreign_project_room(db, monkeypatch):
    customer, project, _, foreign_room = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    body = SelectionIn(
        title="Чужая комната",
        room_id=foreign_room.id,
        category="other",
        client_request_id="selection-foreign-room-0001",
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_selection(project.id, body, customer, db)
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "room_not_found"
