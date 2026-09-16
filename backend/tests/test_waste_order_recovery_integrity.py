"""P0 #316: WasteOrder create and transition lifecycle is replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.router import api_router
from app.api.v1.waste_order_creation_integrity import WasteCreateCommand, create_waste_order_integrity
from app.api.v1.waste_orders import approve_waste, complete_waste, reject_waste, request_waste
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, User, UserRole, WasteOrder

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008601", role=UserRole.customer, full_name="Waste customer")
    contractor = User(phone="+79990008602", role=UserRole.contractor, full_name="Waste contractor")
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name="Waste replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.commit()
    return customer, contractor, project


async def _outbox_count(db, order_id: str) -> int:
    return int(await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "waste_order",
            DomainOutbox.aggregate_id == order_id,
        )
    ) or 0)


async def test_waste_create_and_full_success_path_replay_without_duplicate_effects(db):
    customer, contractor, project = await _fixture(db)
    body = WasteCreateCommand(
        volume_m3=2,
        waste_type="construction",
        price=1500,
        notes="Мешки после демонтажа",
        client_request_id="waste-response-loss-0001",
    )

    first = await create_waste_order_integrity(project.id, body, contractor, db)
    replay = await create_waste_order_integrity(project.id, body, contractor, db)
    assert replay["id"] == first["id"]
    assert first["replayed"] is False
    assert replay["replayed"] is True

    order_count = await db.scalar(
        select(func.count()).select_from(WasteOrder).where(WasteOrder.project_id == project.id)
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "waste_order.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == contractor.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert order_count == 1
    assert ledger_count == 1

    requested = await request_waste(project.id, first["id"], user=contractor, db=db)
    effects_after_request = await _outbox_count(db, first["id"])
    requested_replay = await request_waste(project.id, first["id"], user=contractor, db=db)
    assert requested["status"] == "requested"
    assert requested_replay["replayed"] is True
    assert await _outbox_count(db, first["id"]) == effects_after_request

    approved = await approve_waste(project.id, first["id"], user=customer, db=db)
    effects_after_approve = await _outbox_count(db, first["id"])
    approved_replay = await approve_waste(project.id, first["id"], user=customer, db=db)
    assert approved["status"] == "scheduled"
    assert approved_replay["replayed"] is True
    assert await _outbox_count(db, first["id"]) == effects_after_approve

    done = await complete_waste(project.id, first["id"], user=contractor, db=db)
    effects_after_done = await _outbox_count(db, first["id"])
    done_replay = await complete_waste(project.id, first["id"], user=contractor, db=db)
    assert done["status"] == "done"
    assert done_replay["replayed"] is True
    assert await _outbox_count(db, first["id"]) == effects_after_done


async def test_waste_reject_is_terminal_and_replay_safe(db):
    customer, contractor, project = await _fixture(db)
    created = await create_waste_order_integrity(
        project.id,
        WasteCreateCommand(
            volume_m3=1,
            client_request_id="waste-reject-replay-0001",
        ),
        contractor,
        db,
    )
    await request_waste(project.id, created["id"], user=contractor, db=db)
    rejected = await reject_waste(project.id, created["id"], user=customer, db=db)
    effects_after_reject = await _outbox_count(db, created["id"])
    replay = await reject_waste(project.id, created["id"], user=customer, db=db)
    assert rejected["status"] == "cancelled"
    assert replay["replayed"] is True
    assert await _outbox_count(db, created["id"]) == effects_after_reject

    with pytest.raises(HTTPException) as exc_info:
        await approve_waste(project.id, created["id"], user=customer, db=db)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "invalid_waste_order_transition"


async def test_waste_same_create_request_id_different_payload_conflicts(db):
    _, contractor, project = await _fixture(db)
    request_id = "waste-conflict-0001"
    await create_waste_order_integrity(
        project.id,
        WasteCreateCommand(volume_m3=1, client_request_id=request_id),
        contractor,
        db,
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_waste_order_integrity(
            project.id,
            WasteCreateCommand(volume_m3=3, client_request_id=request_id),
            contractor,
            db,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"


def test_waste_create_runtime_has_one_canonical_handler():
    path = "/api/v1/projects/{project_id}/waste-orders"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("waste_order_creation_integrity")
