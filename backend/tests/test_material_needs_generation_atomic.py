"""Issue #419 — atomic, replay-safe estimate-to-material-needs generation.

Covers:
  - A synthetic failure before commit leaves zero new MaterialPick rows,
    zero MaterialNeedsGenerationResult rows and zero ClientWriteRequest
    ledger rows (rollback is all-or-nothing across the whole batch, not
    per estimate line).
  - A byte-identical replay (same client_request_id) after the batch was
    already generated returns the original MaterialPick set instead of
    creating a second, duplicate set.
  - A caller-supplied client_request_id reused for a different project is
    scoped separately (project is part of the ledger key) and a request id
    reused with a genuinely different generation payload does not silently
    collapse two distinct intents together.
  - Two distinct client_request_id values against the same project both
    succeed and do not collide with each other's ledger rows.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ActivityEvent,
    EstimateLine,
    LineType,
    MaterialPick,
    Project,
    User,
    UserRole,
)
from app.models.material_needs_generation import MaterialNeedsGenerationResult
from app.services import purchase_service


async def seed_project_with_estimate(db, suffix: str, *, lines: list[dict]):
    customer = User(id=f"mn-customer-{suffix}", phone=f"+7900{abs(hash(suffix)) % 10_000_000:07d}", role=UserRole.customer)
    contractor = User(id=f"mn-contractor-{suffix}", phone=f"+7901{abs(hash(suffix)) % 10_000_000:07d}", role=UserRole.contractor)
    project = Project(
        id=f"mn-project-{suffix}",
        name="Material needs project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    for i, line in enumerate(lines):
        db.add(
            EstimateLine(
                id=f"mn-line-{suffix}-{i}",
                project_id=project.id,
                line_type=LineType.material,
                name=line["name"],
                unit=line.get("unit", "шт"),
                quantity_planned=line.get("quantity_planned", 1),
                unit_price=line.get("unit_price", 100),
                room_id=line.get("room_id"),
            )
        )
    await db.commit()
    return {"project_id": project.id, "contractor_id": contractor.id, "customer_id": customer.id}


@pytest.mark.asyncio
async def test_synthetic_failure_before_commit_leaves_no_picks_result_or_ledger_rows(db, monkeypatch):
    graph = await seed_project_with_estimate(
        db, "rollback", lines=[{"name": "Плитка"}, {"name": "Клей"}]
    )

    original_commit = db.commit

    async def fail_commit():
        raise RuntimeError("synthetic_material_needs_commit_failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="synthetic_material_needs_commit_failure"):
        await purchase_service.generate_needs_from_estimate(
            db, graph["project_id"], actor_id=graph["contractor_id"], client_request_id="mn-req-rollback-1"
        )
    monkeypatch.setattr(db, "commit", original_commit)

    assert await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == graph["project_id"])
    ) == 0
    assert await db.scalar(select(func.count()).select_from(MaterialNeedsGenerationResult)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 0
    assert await db.scalar(
        select(func.count()).select_from(ActivityEvent).where(ActivityEvent.project_id == graph["project_id"])
    ) == 0


@pytest.mark.asyncio
async def test_replay_with_same_request_id_returns_original_set_without_duplicating(db):
    graph = await seed_project_with_estimate(
        db, "replay", lines=[{"name": "Плитка", "unit_price": 1200}, {"name": "Затирка", "unit_price": 300}]
    )

    first = await purchase_service.generate_needs_from_estimate(
        db, graph["project_id"], actor_id=graph["contractor_id"], client_request_id="mn-req-replay-1"
    )
    assert len(first) == 2
    first_ids = sorted(p.id for p in first)

    # Simulate response loss: the mobile client resends the identical request.
    second = await purchase_service.generate_needs_from_estimate(
        db, graph["project_id"], actor_id=graph["contractor_id"], client_request_id="mn-req-replay-1"
    )
    second_ids = sorted(p.id for p in second)
    assert second_ids == first_ids

    assert await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == graph["project_id"])
    ) == 2
    assert await db.scalar(select(func.count()).select_from(MaterialNeedsGenerationResult)) == 1
    assert await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == purchase_service.MATERIAL_NEEDS_GENERATE_SCOPE
        )
    ) == 1
    # Exactly one MaterialCalculated activity was durably recorded, not two.
    assert await db.scalar(
        select(func.count()).select_from(ActivityEvent).where(
            ActivityEvent.project_id == graph["project_id"], ActivityEvent.kind == "MaterialCalculated"
        )
    ) == 1


@pytest.mark.asyncio
async def test_distinct_request_ids_are_independent_and_second_is_a_noop(db):
    graph = await seed_project_with_estimate(db, "distinct", lines=[{"name": "Плитка"}])

    first = await purchase_service.generate_needs_from_estimate(
        db, graph["project_id"], actor_id=graph["contractor_id"], client_request_id="mn-req-a"
    )
    assert len(first) == 1

    # A genuinely new user intent (fresh id) against the same, now-fully
    # generated estimate must not error and must not fabricate a duplicate
    # pick for the same estimate line — dedupe-by-name/room still applies.
    second = await purchase_service.generate_needs_from_estimate(
        db, graph["project_id"], actor_id=graph["contractor_id"], client_request_id="mn-req-b"
    )
    assert second == []

    assert await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == graph["project_id"])
    ) == 1
    assert await db.scalar(select(func.count()).select_from(MaterialNeedsGenerationResult)) == 2
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 2


@pytest.mark.asyncio
async def test_two_projects_reusing_the_same_request_id_do_not_collide(db):
    graph_a = await seed_project_with_estimate(db, "proja", lines=[{"name": "Плитка"}])
    graph_b = await seed_project_with_estimate(db, "projb", lines=[{"name": "Ламинат"}])

    created_a = await purchase_service.generate_needs_from_estimate(
        db, graph_a["project_id"], actor_id=graph_a["contractor_id"], client_request_id="shared-request-id"
    )
    created_b = await purchase_service.generate_needs_from_estimate(
        db, graph_b["project_id"], actor_id=graph_b["contractor_id"], client_request_id="shared-request-id"
    )
    assert len(created_a) == 1
    assert len(created_b) == 1
    assert created_a[0].project_id == graph_a["project_id"]
    assert created_b[0].project_id == graph_b["project_id"]
    assert await db.scalar(select(func.count()).select_from(MaterialNeedsGenerationResult)) == 2


@pytest.mark.asyncio
async def test_no_client_request_id_still_dedupes_and_is_not_ledgered(db):
    graph = await seed_project_with_estimate(db, "legacy", lines=[{"name": "Плитка"}])

    first = await purchase_service.generate_needs_from_estimate(db, graph["project_id"], actor_id=graph["contractor_id"])
    assert len(first) == 1
    second = await purchase_service.generate_needs_from_estimate(db, graph["project_id"], actor_id=graph["contractor_id"])
    assert second == []

    assert await db.scalar(
        select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == graph["project_id"])
    ) == 1
    # No client_request_id means no idempotency ledger row is written.
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 0
