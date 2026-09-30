"""EST-001/QLT-001: room edits must not rewrite a locked estimate."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.timeutil import utc_now
from app.models.entities import EstimateLine, Project
from app.services import room_change_service
from app.services import room_mutation_service as mutations
from tests.test_room_mutation_integrity import room_payload, seed_project


async def _snapshot(db, project_id: str):
    rows = (
        await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id).execution_options(populate_existing=True))
    ).scalars().all()
    total = round(sum(r.quantity_planned * r.unit_price for r in rows), 2)
    project = await db.get(Project, project_id, populate_existing=True)
    lines = sorted((r.id, r.quantity_planned, r.unit_price) for r in rows)
    return total, project.budget_planned, lines


async def _room(db, contractor, project, tag):
    created = await mutations.create_room(
        db, project=project, actor=contractor,
        data=room_payload(), client_request_id=f"lock-{tag}-create",
    )
    return created.room.id


async def _lock(db, project_id: str):
    project = await db.get(Project, project_id)
    project.estimate_locked_at = utc_now()
    await db.commit()


@pytest.mark.asyncio
async def test_direct_edit_recalculates_before_lock_and_freezes_after(db):
    _, contractor, project = await seed_project(db, "lock-direct")
    pid = project.id
    room_id = await _room(db, contractor, project, "direct")
    t0, b0, _ = await _snapshot(db, pid)
    assert t0 > 0

    res = await mutations.update_room(
        db, project=project, room_id=room_id, actor=contractor, data={"width_m": 6},
    )
    assert res.estimate_frozen is False
    t1, b1, _ = await _snapshot(db, pid)
    assert t1 > t0 and b1 > b0

    await _lock(db, pid)
    project = await db.get(Project, pid)
    res = await mutations.update_room(
        db, project=project, room_id=room_id, actor=contractor, data={"width_m": 12},
    )
    assert res.estimate_frozen is True
    assert res.room.width_m == 12  # room data itself is saved
    t2, b2, l2 = await _snapshot(db, pid)
    assert (t2, b2) == (t1, b1)
    _, _, l1 = await _snapshot(db, pid)
    assert l1 == l2


@pytest.mark.asyncio
async def test_approved_request_recalculates_before_lock_and_freezes_after(db):
    customer, contractor, project = await seed_project(db, "lock-request")
    pid = project.id
    room_id = await _room(db, contractor, project, "request")
    t0, b0, _ = await _snapshot(db, pid)

    req, _ = await room_change_service.create_request(
        db, project=project, actor=customer, room_id=room_id,
        message="шире", payload={"width_m": 6}, client_request_id="lock-req-0001",
    )
    await room_change_service.decide_request(
        db, project=project, request_id=req.id, actor=contractor, decision="approve",
    )
    t1, b1, _ = await _snapshot(db, pid)
    assert t1 > t0 and b1 > b0

    await _lock(db, pid)
    project = await db.get(Project, pid)
    req2, _ = await room_change_service.create_request(
        db, project=project, actor=customer, room_id=room_id,
        message="ещё шире", payload={"width_m": 12}, client_request_id="lock-req-0002",
    )
    _, room, _, changes = await room_change_service.decide_request(
        db, project=project, request_id=req2.id, actor=contractor, decision="approve",
    )
    assert changes and room.width_m == 12
    t2, b2, _ = await _snapshot(db, pid)
    assert (t2, b2) == (t1, b1)
