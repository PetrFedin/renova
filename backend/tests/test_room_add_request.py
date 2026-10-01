"""QLT-007/QLT-009: customer asks to add a room once an executor is linked."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox, EstimateLine, Project, Room, RoomChangeRequest
from app.schemas.project import RoomInput
from app.services import room_change_service as svc
from app.services import room_mutation_service as mutations
from app.services import room_service
from tests.test_room_mutation_integrity import seed_project

NEW_ROOM = {"name": "Кладовая", "room_type": "storage", "length_m": 2, "width_m": 1.5}


async def _room_count(db, project_id):
    return await db.scalar(
        select(func.count()).select_from(Room).where(Room.project_id == project_id)
    )


@pytest.mark.asyncio
async def test_customer_direct_create_still_forbidden_but_request_creates_room_on_approve(db):
    customer, contractor, project = await seed_project(db, "addreq-ok")
    pid = project.id
    with pytest.raises(ValueError, match="room_direct_editor_forbidden"):
        await mutations.create_room(
            db, project=project, actor=customer,
            data={**NEW_ROOM, "name": "X"}, client_request_id="addreq-direct-0001",
        )

    req, replayed = await svc.create_request(
        db, project=project, actor=customer, room_id=None,
        message="Нужна кладовая", payload=NEW_ROOM, client_request_id="addreq-ok-0001",
    )
    assert not replayed and req.room_id is None
    assert await _room_count(db, pid) == 0  # nothing created before approval

    notes = (
        await db.execute(
            select(DomainOutbox).where(DomainOutbox.aggregate_id == req.id)
        )
    ).scalars().all()
    assert any("добавление комнаты" in (n.payload_json or "").lower() for n in notes)

    out, room, was_replay, changes = await svc.decide_request(
        db, project=project, request_id=req.id, actor=contractor, decision="approve",
    )
    assert room is not None and room.name == "Кладовая" and not was_replay and changes
    assert out.created_room_id == room.id
    assert await _room_count(db, pid) == 1
    assert (await db.scalar(select(func.count()).select_from(EstimateLine).where(EstimateLine.room_id == room.id))) > 0

    # idempotent: second approve returns the same room, no second room
    _, room2, replay2, _ = await svc.decide_request(
        db, project=project, request_id=req.id, actor=contractor, decision="approve",
    )
    assert replay2 and room2.id == room.id
    assert await _room_count(db, pid) == 1


@pytest.mark.asyncio
async def test_reject_creates_no_room_and_cannot_be_approved_after(db):
    customer, contractor, project = await seed_project(db, "addreq-rej")
    req, _ = await svc.create_request(
        db, project=project, actor=customer, room_id=None,
        message="Нужна кладовая", payload=NEW_ROOM, client_request_id="addreq-rej-0001",
    )
    _, room, _, changes = await svc.decide_request(
        db, project=project, request_id=req.id, actor=contractor, decision="reject",
    )
    assert room is None and not changes
    assert await _room_count(db, project.id) == 0
    with pytest.raises(ValueError, match="room_change_final_state_conflict"):
        await svc.decide_request(
            db, project=project, request_id=req.id, actor=contractor, decision="approve",
        )


@pytest.mark.asyncio
async def test_approve_on_locked_estimate_creates_room_without_recalc(db):
    customer, contractor, project = await seed_project(db, "addreq-lock")
    pid = project.id
    project.estimate_locked_at = utc_now()
    await db.commit()
    before = await db.scalar(select(func.count()).select_from(EstimateLine).where(EstimateLine.project_id == pid))
    budget = (await db.get(Project, pid)).budget_planned
    req, _ = await svc.create_request(
        db, project=project, actor=customer, room_id=None,
        message="Кладовая", payload=NEW_ROOM, client_request_id="addreq-lock-0001",
    )
    _, room, _, changes = await svc.decide_request(
        db, project=project, request_id=req.id, actor=contractor, decision="approve",
    )
    assert room is not None and changes
    assert room_service.estimate_is_locked(project)
    assert await db.scalar(select(func.count()).select_from(EstimateLine).where(EstimateLine.project_id == pid)) == before
    assert (await db.get(Project, pid, populate_existing=True)).budget_planned == budget


@pytest.mark.asyncio
async def test_add_request_validation_and_no_contractor(db):
    customer, _, project = await seed_project(db, "addreq-val")
    for bad in (None, {"name": "A"}, {**NEW_ROOM, "length_m": -1}, {**NEW_ROOM, "width_m": 5000}, {**NEW_ROOM, "id": "x"}):
        with pytest.raises(ValueError, match="room_"):
            await svc.create_request(
                db, project=project, actor=customer, room_id=None,
                message="m", payload=bad,
            )
    assert await db.scalar(select(func.count()).select_from(RoomChangeRequest)) == 0

    customer2, _, solo = await seed_project(db, "addreq-solo", with_contractor=False)
    with pytest.raises(ValueError, match="room_change_no_contractor"):
        await svc.create_request(
            db, project=solo, actor=customer2, room_id=None,
            message="m", payload=NEW_ROOM,
        )
    # without an executor the customer still creates directly
    res = await mutations.create_room(
        db, project=solo, actor=customer2, data={**NEW_ROOM, "name": "Прямая"},
        client_request_id="addreq-solo-direct1",
    )
    assert res.room.name == "Прямая"


@pytest.mark.asyncio
async def test_add_request_create_is_idempotent(db):
    customer, _, project = await seed_project(db, "addreq-idem")
    a, ra = await svc.create_request(
        db, project=project, actor=customer, room_id=None,
        message="m", payload=NEW_ROOM, client_request_id="addreq-idem-0001",
    )
    b, rb = await svc.create_request(
        db, project=project, actor=customer, room_id=None,
        message="m", payload=NEW_ROOM, client_request_id="addreq-idem-0001",
    )
    assert not ra and rb and a.id == b.id


def test_room_size_bounds_422():
    with pytest.raises(Exception):
        RoomInput(name="a", length_m=0, width_m=3)
    with pytest.raises(Exception):
        RoomInput(name="a", length_m=3, width_m=3, height_m=50)
    with pytest.raises(ValueError, match="room_patch_number_invalid:width_m"):
        room_service.validate_room_patch({"width_m": 1e9})
    with pytest.raises(ValueError, match="room_patch_number_invalid"):
        room_service.validate_room_patch({"length_m": float("nan")})
