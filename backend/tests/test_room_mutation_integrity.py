from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import rooms as rooms_api
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    EstimateLine,
    LineType,
    Project,
    Room,
    RoomChangeLog,
    User,
    UserRole,
)
from app.schemas.project import RoomUpdate
from app.services import room_mutation_service as mutations
from app.services.client_write_idempotency import IdempotencyConflict


async def seed_project(db, suffix: str):
    phone_tail = sum(
        (index + 1) * ord(character)
        for index, character in enumerate(suffix)
    ) % 10_000_000
    customer = User(
        id=f"room-customer-{suffix}",
        phone=f"+7801{phone_tail:07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"room-contractor-{suffix}",
        phone=f"+7802{phone_tail:07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"room-project-{suffix}",
        name="Room mutation integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


def room_payload(**overrides):
    payload = {
        "name": "Гостиная",
        "room_type": "living",
        "floor_level": 1,
        "length_m": 4,
        "width_m": 3,
        "height_m": 2.7,
        "openings_sq_m": 2,
        "outlets_count": 0,
        "switches_count": 0,
        "plumbing_points": 0,
        "notes": None,
        "budget_alert_pct": None,
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_customer_cannot_bypass_room_change_with_direct_mutation(db):
    customer, contractor, project = await seed_project(db, "policy")
    created = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id="room-policy-create",
    )
    room_id = created.room.id

    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.update_room(
            db,
            project=project,
            room_id=room_id,
            actor=customer,
            data={"width_m": 5},
        )
    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.create_room(
            db,
            project=project,
            actor=customer,
            data=room_payload(name="Обход"),
            client_request_id="room-policy-bypass",
        )

    with pytest.raises(HTTPException) as captured:
        await rooms_api.update_room(
            project.id,
            room_id,
            RoomUpdate(width_m=5),
            user=customer,
            db=db,
        )
    assert captured.value.status_code == 403
    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == 3


@pytest.mark.asyncio
async def test_room_create_is_idempotent_and_conflict_safe(db):
    _, contractor, project = await seed_project(db, "idempotency")
    project_id = project.id
    contractor_id = contractor.id
    request_id = "room-create-request-0001"

    first = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id=request_id,
    )
    room_id = first.room.id
    second = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id=request_id,
    )

    assert first.replayed is False
    assert second.replayed is True
    assert second.room.id == room_id
    assert await db.scalar(
        select(func.count()).select_from(Room).where(Room.project_id == project_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "room",
            DomainOutbox.aggregate_id == room_id,
        )
    ) == 2

    contractor = await db.get(User, contractor_id)
    project = await db.get(Project, project_id)
    with pytest.raises(IdempotencyConflict):
        await mutations.create_room(
            db,
            project=project,
            actor=contractor,
            data=room_payload(width_m=4),
            client_request_id=request_id,
        )
    assert await db.scalar(
        select(func.count()).select_from(Room).where(Room.project_id == project_id)
    ) == 1


@pytest.mark.asyncio
async def test_update_recalculates_finish_and_engineering_without_losing_manual_evidence(db):
    _, contractor, project = await seed_project(db, "recalc")
    project_id = project.id
    contractor_id = contractor.id
    created = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id="room-recalc-create",
    )
    room_id = created.room.id

    laminate = (
        await db.execute(
            select(EstimateLine).where(
                EstimateLine.room_id == room_id,
                EstimateLine.category == "finish",
                EstimateLine.name == "Укладка ламината",
            )
        )
    ).scalar_one()
    laminate_id = laminate.id
    laminate.unit_price = 777
    laminate.quantity_actual = 2
    manual = EstimateLine(
        project_id=project_id,
        room_id=room_id,
        line_type=LineType.work,
        name="Авторская ниша",
        unit="шт",
        quantity_planned=1,
        quantity_actual=0.5,
        unit_price=5000,
        room_name="Гостиная",
        category="finish",
        notes="Ручная строка",
    )
    db.add(manual)
    await db.commit()
    manual_id = manual.id

    contractor = await db.get(User, contractor_id)
    project = await db.get(Project, project_id)
    result = await mutations.update_room(
        db,
        project=project,
        room_id=room_id,
        actor=contractor,
        data={"name": "Большая гостиная", "width_m": 5, "outlets_count": 3},
    )
    assert result is not None
    assert result.replayed is False
    assert set(result.changes) == {"name", "width_m", "outlets_count"}

    line_id, quantity, actual, price, room_name = (
        await db.execute(
            select(
                EstimateLine.id,
                EstimateLine.quantity_planned,
                EstimateLine.quantity_actual,
                EstimateLine.unit_price,
                EstimateLine.room_name,
            ).where(
                EstimateLine.room_id == room_id,
                EstimateLine.category == "finish",
                EstimateLine.name == "Укладка ламината",
            )
        )
    ).one()
    assert line_id == laminate_id
    assert quantity == 20
    assert actual == 2
    assert price == 777
    assert room_name == "Большая гостиная"

    manual_row = (
        await db.execute(
            select(EstimateLine).where(EstimateLine.id == manual_id)
        )
    ).scalar_one()
    assert manual_row.name == "Авторская ниша"
    assert manual_row.unit_price == 5000
    assert manual_row.quantity_actual == 0.5

    electrical = list(
        (
            await db.execute(
                select(EstimateLine).where(
                    EstimateLine.room_id == room_id,
                    EstimateLine.category == "electrical",
                )
            )
        ).scalars().all()
    )
    assert len(electrical) == 2
    assert {line.quantity_planned for line in electrical} == {3}

    calculated_budget = await db.scalar(
        select(func.sum(EstimateLine.quantity_planned * EstimateLine.unit_price)).where(
            EstimateLine.project_id == project_id
        )
    )
    stored_budget = await db.scalar(
        select(Project.budget_planned).where(Project.id == project_id)
    )
    assert stored_budget == pytest.approx(float(calculated_budget), abs=0.01)
    assert await db.scalar(
        select(func.count())
        .select_from(RoomChangeLog)
        .where(RoomChangeLog.room_id == room_id)
    ) == 3
    assert await db.scalar(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.project_id == project_id,
            ActivityEvent.kind == "RoomUpdated",
        )
    ) == 1


@pytest.mark.asyncio
async def test_noop_update_is_replay_safe_without_duplicate_effects(db):
    _, contractor, project = await seed_project(db, "noop")
    created = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id="room-noop-create",
    )
    room_id = created.room.id
    outbox_before = await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == room_id)
    )

    result = await mutations.update_room(
        db,
        project=project,
        room_id=room_id,
        actor=contractor,
        data={"name": "Гостиная"},
    )
    assert result is not None
    assert result.replayed is True
    assert result.changes == {}
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == room_id)
    ) == outbox_before
    assert await db.scalar(
        select(func.count())
        .select_from(RoomChangeLog)
        .where(RoomChangeLog.room_id == room_id)
    ) == 0


@pytest.mark.asyncio
async def test_effect_failure_rolls_back_room_estimates_budget_and_audit(db, monkeypatch):
    _, contractor, project = await seed_project(db, "rollback")
    project_id = project.id
    contractor_id = contractor.id
    created = await mutations.create_room(
        db,
        project=project,
        actor=contractor,
        data=room_payload(),
        client_request_id="room-rollback-create",
    )
    room_id = created.room.id
    baseline_width = await db.scalar(select(Room.width_m).where(Room.id == room_id))
    baseline_budget = await db.scalar(
        select(Project.budget_planned).where(Project.id == project_id)
    )
    baseline_quantity = await db.scalar(
        select(EstimateLine.quantity_planned).where(
            EstimateLine.room_id == room_id,
            EstimateLine.name == "Укладка ламината",
        )
    )
    baseline_outbox = await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == room_id)
    )

    async def fail_effects(*_args, **_kwargs):
        raise RuntimeError("synthetic_room_effect_failure")

    monkeypatch.setattr(mutations, "_prepare_effects", fail_effects)
    contractor = await db.get(User, contractor_id)
    project = await db.get(Project, project_id)
    with pytest.raises(RuntimeError, match="synthetic_room_effect_failure"):
        await mutations.update_room(
            db,
            project=project,
            room_id=room_id,
            actor=contractor,
            data={"width_m": 5},
        )

    assert await db.scalar(select(Room.width_m).where(Room.id == room_id)) == baseline_width
    assert await db.scalar(
        select(Project.budget_planned).where(Project.id == project_id)
    ) == baseline_budget
    assert await db.scalar(
        select(EstimateLine.quantity_planned).where(
            EstimateLine.room_id == room_id,
            EstimateLine.name == "Укладка ламината",
        )
    ) == baseline_quantity
    assert await db.scalar(
        select(func.count())
        .select_from(RoomChangeLog)
        .where(RoomChangeLog.room_id == room_id)
    ) == 0
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == room_id)
    ) == baseline_outbox


@pytest.mark.asyncio
async def test_room_change_log_cannot_read_foreign_project_room(db):
    customer_a, _, project_a = await seed_project(db, "acl-a")
    _, contractor_b, project_b = await seed_project(db, "acl-b")
    foreign = await mutations.create_room(
        db,
        project=project_b,
        actor=contractor_b,
        data=room_payload(name="Чужая комната"),
        client_request_id="room-foreign-create",
    )

    with pytest.raises(HTTPException) as captured:
        await rooms_api.room_change_log(
            project_a.id,
            foreign.room.id,
            user=customer_a,
            db=db,
        )
    assert captured.value.status_code == 404
