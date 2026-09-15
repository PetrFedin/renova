from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import rooms as rooms_api
from app.models.entities import EstimateLine, Project, Room, User, UserRole
from app.models.project_participants import ProjectParticipant
from app.schemas.project import RoomUpdate
from app.services import project_participant_service as participants
from app.services import room_authority_service as authority
from app.services import room_mutation_service as mutations
from app.services import room_service


def _room_payload(name: str = "Кухня") -> dict:
    return {
        "name": name,
        "room_type": "kitchen",
        "floor_level": 1,
        "length_m": 4,
        "width_m": 3,
        "height_m": 2.7,
        "openings_sq_m": 2,
        "outlets_count": 2,
        "switches_count": 1,
        "plumbing_points": 1,
        "notes": None,
        "budget_alert_pct": None,
    }


async def _seed_pre_executor_project(db, suffix: str):
    customer = User(
        id=f"authority-customer-{suffix}",
        phone=f"+7810{sum(ord(c) for c in suffix) % 10_000_000:07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"authority-contractor-{suffix}",
        phone=f"+7820{sum((i + 1) * ord(c) for i, c in enumerate(suffix)) % 10_000_000:07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"authority-project-{suffix}",
        name="Authority transition",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=None,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    room = await room_service.prepare_room(db, project=project, data=_room_payload())
    await db.commit()
    await db.refresh(customer)
    await db.refresh(contractor)
    await db.refresh(project)
    await db.refresh(room)
    return customer, contractor, project, room


async def _planned_total(db, project_id: str) -> float:
    value = await db.scalar(
        select(func.coalesce(func.sum(EstimateLine.quantity_planned * EstimateLine.unit_price), 0))
        .where(EstimateLine.project_id == project_id)
    )
    return float(value or 0)


@pytest.mark.asyncio
async def test_customer_direct_room_edit_transfers_to_request_mode_when_executor_attaches(db):
    customer, contractor, project, room = await _seed_pre_executor_project(db, "lead")
    project_id, room_id = project.id, room.id

    before = await rooms_api.room_authority(project_id, user=customer, db=db)
    assert before == {
        "has_active_executor": False,
        "direct_edit_allowed": True,
        "change_request_required": False,
    }

    baseline_budget = await _planned_total(db, project_id)
    edited = await mutations.update_room(
        db,
        project=project,
        room_id=room_id,
        actor=customer,
        data={"width_m": 5, "outlets_count": 4},
    )
    assert edited is not None
    assert edited.replayed is False
    assert set(edited.changes) == {"width_m", "outlets_count"}
    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == 5
    recalculated = await _planned_total(db, project_id)
    assert recalculated != baseline_budget
    assert await db.scalar(select(Project.budget_planned).where(Project.id == project_id)) == pytest.approx(recalculated, abs=0.01)

    # Handoff to the lead contractor is one authoritative transition: both the
    # compatibility lead and ProjectParticipant truth become active.
    project = await db.get(Project, project_id, populate_existing=True)
    await participants.sync_current_lead_in_transaction(
        db,
        project=project,
        contractor_id=contractor.id,
        actor_id=customer.id,
    )
    await db.commit()
    customer = await db.get(User, customer.id, populate_existing=True)
    project = await db.get(Project, project_id, populate_existing=True)

    after = await rooms_api.room_authority(project_id, user=customer, db=db)
    assert after == {
        "has_active_executor": True,
        "direct_edit_allowed": False,
        "change_request_required": True,
    }

    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.update_room(
            db,
            project=project,
            room_id=room_id,
            actor=customer,
            data={"width_m": 6},
        )
    with pytest.raises(HTTPException) as denied:
        await rooms_api.update_room(
            project_id,
            room_id,
            RoomUpdate(width_m=6),
            user=customer,
            db=db,
        )
    assert denied.value.status_code == 403
    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == 5

    contractor = await db.get(User, contractor.id, populate_existing=True)
    project = await db.get(Project, project_id, populate_existing=True)
    contractor_authority = await rooms_api.room_authority(project_id, user=contractor, db=db)
    assert contractor_authority["has_active_executor"] is True
    assert contractor_authority["direct_edit_allowed"] is True
    assert contractor_authority["change_request_required"] is False

    contractor_edit = await mutations.update_room(
        db,
        project=project,
        room_id=room_id,
        actor=contractor,
        data={"width_m": 6},
    )
    assert contractor_edit is not None
    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == 6
    final_budget = await _planned_total(db, project_id)
    assert await db.scalar(select(Project.budget_planned).where(Project.id == project_id)) == pytest.approx(final_budget, abs=0.01)


@pytest.mark.asyncio
async def test_independent_active_participant_blocks_customer_direct_edit_without_legacy_lead(db):
    customer, contractor, project, room = await _seed_pre_executor_project(db, "participant")
    project_id, room_id = project.id, room.id
    assert project.contractor_id is None

    db.add(
        ProjectParticipant(
            project_id=project_id,
            user_id=contractor.id,
            participant_role="contractor",
            status="active",
            all_scope=True,
            can_manage_schedule=True,
            can_manage_commercial=True,
            can_manage_documents=True,
            added_by=customer.id,
        )
    )
    await db.commit()
    customer = await db.get(User, customer.id, populate_existing=True)
    project = await db.get(Project, project_id, populate_existing=True)

    assert project.contractor_id is None
    descriptor = await authority.describe_room_authority(db, project=project, actor=customer)
    assert descriptor.has_active_executor is True
    assert descriptor.direct_edit_allowed is False

    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.update_room(
            db,
            project=project,
            room_id=room_id,
            actor=customer,
            data={"width_m": 7},
        )
    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == 3


@pytest.mark.asyncio
async def test_customer_standalone_room_create_remains_denied(db):
    customer, _contractor, project, _room = await _seed_pre_executor_project(db, "create")
    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.create_room(
            db,
            project=project,
            actor=customer,
            data=_room_payload("Спальня"),
            client_request_id="customer-room-create-denied",
        )
