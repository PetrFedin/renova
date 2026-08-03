from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func, select

import app.models.client_write_request  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, Stage, StageStatus, User, UserRole
from app.services import client_write_idempotency
from app.services import stage_mutation_service as mutations


@pytest.mark.asyncio
async def test_concurrent_stage_create_reloads_canonical_after_ledger_rollback(
    db,
    monkeypatch,
):
    customer = User(
        id="stage-race-customer",
        phone="+76100000001",
        role=UserRole.customer,
    )
    contractor = User(
        id="stage-race-contractor",
        phone="+76100000002",
        role=UserRole.contractor,
    )
    project = Project(
        id="stage-race-project",
        name="Concurrent stage create",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        planned_start_date=date(2026, 8, 1),
        planned_end_date=date(2026, 10, 31),
    )
    canonical = Stage(
        id="stage-race-canonical",
        project_id=project.id,
        name="Электромонтаж",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 8, 16),
        planned_end=date(2026, 8, 20),
        work_type="electrical",
    )
    db.add_all([customer, contractor, project, canonical])
    await db.commit()
    project_id = project.id
    contractor_id = contractor.id
    canonical_id = canonical.id

    async def force_race_miss(*_args, **_kwargs):
        return None

    async def collapse_to_concurrent_winner(session, **_kwargs):
        await session.rollback()
        return False, canonical_id

    monkeypatch.setattr(
        client_write_idempotency,
        "replay_entity_id",
        force_race_miss,
    )
    monkeypatch.setattr(
        client_write_idempotency,
        "commit_client_write",
        collapse_to_concurrent_winner,
    )

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    result = await mutations.create_stage(
        db,
        project_id=project_id,
        actor=contractor,
        name="Электромонтаж",
        planned_start=date(2026, 8, 16),
        planned_end=date(2026, 8, 20),
        work_type="electrical",
        client_request_id="stage-race-request",
    )

    assert result.replayed is True
    assert result.stage.id == canonical_id
    assert result.stage.project_id == project_id
    assert await db.scalar(
        select(func.count()).select_from(Stage).where(Stage.project_id == project_id)
    ) == 1
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 0
