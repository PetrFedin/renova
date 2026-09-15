from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, EstimateLine, LineType, MaterialPick, Project, User, UserRole
from app.services import material_need_generation_service as generation


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def _seed(db):
    customer = User(
        id=_id("needs-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    project = Project(
        id=_id("needs-project"),
        name="Material needs replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    line = EstimateLine(
        id=_id("needs-line"),
        project_id=project.id,
        line_type=LineType.material,
        name="Плитка",
        unit="м2",
        quantity_planned=8,
        unit_price=1200,
    )
    db.add_all([customer, project, line])
    await db.commit()
    return customer, project


async def _count(db, model, *where) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


@pytest.mark.asyncio
async def test_material_needs_replay_returns_original_snapshot_after_estimate_changes(db, monkeypatch):
    async def no_dispatch(*_args, **_kwargs):
        return 0

    from app.services import outbox_inline_dispatch

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    customer, project = await _seed(db)

    first, replayed = await generation.generate_from_estimate(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="material-needs-response-loss-001",
    )
    assert replayed is False
    assert [item["name"] for item in first] == ["Плитка"]
    first_snapshot = list(first)
    assert await _count(db, MaterialPick, MaterialPick.project_id == project.id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == generation.SCOPE,
    ) == 1
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.project_id == project.id if hasattr(DomainOutbox, "project_id") else DomainOutbox.aggregate_type == generation.AGGREGATE_TYPE,
    ) >= 1

    db.add(
        EstimateLine(
            id=_id("needs-line"),
            project_id=project.id,
            line_type=LineType.material,
            name="Краска",
            unit="л",
            quantity_planned=5,
            unit_price=700,
        )
    )
    await db.commit()

    same_intent, replayed = await generation.generate_from_estimate(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="material-needs-response-loss-001",
    )
    assert replayed is True
    assert same_intent == first_snapshot
    assert await _count(db, MaterialPick, MaterialPick.project_id == project.id) == 1

    second_intent, replayed = await generation.generate_from_estimate(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="material-needs-response-loss-002",
    )
    assert replayed is False
    assert [item["name"] for item in second_intent] == ["Краска"]
    assert await _count(db, MaterialPick, MaterialPick.project_id == project.id) == 2

    zero_intent, replayed = await generation.generate_from_estimate(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="material-needs-response-loss-003",
    )
    assert replayed is False
    assert zero_intent == []

    zero_replay, replayed = await generation.generate_from_estimate(
        db,
        project_id=project.id,
        user_id=customer.id,
        client_request_id="material-needs-response-loss-003",
    )
    assert replayed is True
    assert zero_replay == []
    assert await _count(db, MaterialPick, MaterialPick.project_id == project.id) == 2
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.project_id == project.id,
        ClientWriteRequest.scope == generation.SCOPE,
    ) == 3
    assert await _count(
        db,
        DomainOutbox,
        DomainOutbox.aggregate_type == generation.AGGREGATE_TYPE,
    ) == 2
