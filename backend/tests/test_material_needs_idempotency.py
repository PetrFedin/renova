"""P0 #316: estimate material-needs batch survives response loss exactly once."""

import pytest
from sqlalchemy import func, select

from app.api.v1.material_needs_integrity import (
    GenerateMaterialNeedsIn,
    generate_material_needs_integrity,
)
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    DomainOutbox,
    EstimateLine,
    LineType,
    MaterialPick,
    Project,
    Room,
    User,
    UserRole,
)
from app.services import outbox_inline_dispatch

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(
        phone="+79990006101",
        role=UserRole.customer,
        full_name="Material needs customer",
    )
    contractor = User(
        phone="+79990006102",
        role=UserRole.contractor,
        full_name="Material needs contractor",
    )
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name="Material needs project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.flush()
    room = Room(project_id=project.id, name="Kitchen", room_type="kitchen", length_m=4, width_m=3)
    db.add(room)
    await db.flush()
    db.add_all(
        [
            EstimateLine(
                project_id=project.id,
                room_id=room.id,
                line_type=LineType.material,
                name="Краска",
                unit="л",
                quantity_planned=10,
                quantity_actual=0,
                unit_price=500,
                category="paint",
            ),
            EstimateLine(
                project_id=project.id,
                room_id=room.id,
                line_type=LineType.material,
                name="Грунт",
                unit="л",
                quantity_planned=5,
                quantity_actual=0,
                unit_price=300,
                category="paint",
            ),
        ]
    )
    await db.commit()
    return customer, project


async def _no_dispatch(*_args, **_kwargs):
    return None


async def test_material_needs_response_loss_replay_creates_one_batch_and_one_activity(db, monkeypatch):
    customer, project = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    body = GenerateMaterialNeedsIn(client_request_id="material-needs-response-loss-0001")

    first = await generate_material_needs_integrity(project.id, body, customer, db)
    assert first["replayed"] is False
    assert first["count"] == 2

    replay = await generate_material_needs_integrity(project.id, body, customer, db)
    assert replay == {"count": 0, "created": [], "replayed": True}

    pick_count = await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == project.id)
    )
    assert pick_count == 2

    request_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "material_needs.from_estimate",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert request_count == 1

    outbox_count = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "material_needs",
            DomainOutbox.aggregate_id == project.id,
        )
    )
    assert outbox_count == 1


async def test_new_material_needs_command_after_existing_batch_is_safe_noop(db, monkeypatch):
    customer, project = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)

    first = await generate_material_needs_integrity(
        project.id,
        GenerateMaterialNeedsIn(client_request_id="material-needs-first-0001"),
        customer,
        db,
    )
    assert first["count"] == 2

    second = await generate_material_needs_integrity(
        project.id,
        GenerateMaterialNeedsIn(client_request_id="material-needs-second-0001"),
        customer,
        db,
    )
    assert second["replayed"] is False
    assert second["count"] == 0

    pick_count = await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == project.id)
    )
    assert pick_count == 2
    outbox_count = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "material_needs",
            DomainOutbox.aggregate_id == project.id,
        )
    )
    assert outbox_count == 1
