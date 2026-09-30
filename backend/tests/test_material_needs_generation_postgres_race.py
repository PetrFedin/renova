"""#419: real PostgreSQL race proof for material-needs-from-estimate generation.

An in-memory SQLite unit test cannot prove the project-row lock + the
ClientWriteRequest unique constraint actually serialize two truly concurrent
generation attempts into a single, non-duplicated MaterialPick set — that
only shows up under a real database with two independent connections racing
the same commit. This reproduces the offline queue's response-loss retry
(and a genuine double-tap) as two concurrent requests against a real
(migrated) PostgreSQL instance and asserts they collapse into exactly one
canonical generated MaterialPick set, one ledger row, and one durable
MaterialCalculated activity effect.
"""
from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, EstimateLine, LineType, MaterialPick, Project, User, UserRole
from app.models.material_needs_generation import MaterialNeedsGenerationResult
from app.services import purchase_service


def _postgres_url() -> str:
    value = os.environ.get("MATERIAL_NEEDS_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("MATERIAL_NEEDS_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


@pytest.mark.asyncio
async def test_concurrent_same_request_collapses_to_one_generation():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "matneeds-race-customer"
    contractor_id = "matneeds-race-contractor"
    project_id = "matneeds-race-project"
    request_id = "matneeds-race-request-0001"
    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone="+79664440001", role=UserRole.customer, full_name="Race customer"),
                User(id=contractor_id, phone="+79664440002", role=UserRole.contractor, full_name="Race contractor"),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="Material needs race", renovation_type="cosmetic",
                customer_id=customer_id, contractor_id=contractor_id,
            ))
            db.add(EstimateLine(
                id="matneeds-race-line-1", project_id=project_id, line_type=LineType.material,
                name="Плитка", unit="м2", quantity_planned=10, unit_price=1500,
            ))
            await db.commit()

        async def generate_once():
            async with Session() as db:
                created = await purchase_service.generate_needs_from_estimate(
                    db,
                    project_id,
                    actor_id=contractor_id,
                    client_request_id=request_id,
                )
                return [p.id for p in created]

        ids_a, ids_b = await asyncio.gather(generate_once(), generate_once())
        assert ids_a == ids_b
        assert len(ids_a) == 1

        async with Session() as db:
            pick_count = await db.scalar(
                select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == project_id)
            )
            assert pick_count == 1

            result_count = await db.scalar(select(func.count()).select_from(MaterialNeedsGenerationResult))
            assert result_count == 1

            request_count = await db.scalar(
                select(func.count()).select_from(ClientWriteRequest).where(
                    ClientWriteRequest.scope == purchase_service.MATERIAL_NEEDS_GENERATE_SCOPE,
                    ClientWriteRequest.project_id == project_id,
                    ClientWriteRequest.user_id == contractor_id,
                    ClientWriteRequest.request_id == request_id,
                )
            )
            assert request_count == 1

            outbox_count = await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_type == "material_needs_generation",
                )
            )
            assert outbox_count == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_calls_without_request_id_never_double_insert_same_line():
    """No explicit client_request_id (legacy/manual retry): the project-row
    lock alone (not the idempotency ledger) must still prevent two racing
    sessions from both observing "no existing pick" and both inserting it.
    """
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "matneeds-race2-customer"
    contractor_id = "matneeds-race2-contractor"
    project_id = "matneeds-race2-project"
    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone="+79664450001", role=UserRole.customer, full_name="Race2 customer"),
                User(id=contractor_id, phone="+79664450002", role=UserRole.contractor, full_name="Race2 contractor"),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="Material needs race 2", renovation_type="cosmetic",
                customer_id=customer_id, contractor_id=contractor_id,
            ))
            db.add(EstimateLine(
                id="matneeds-race2-line-1", project_id=project_id, line_type=LineType.material,
                name="Ламинат", unit="м2", quantity_planned=20, unit_price=900,
            ))
            await db.commit()

        async def generate_once():
            async with Session() as db:
                created = await purchase_service.generate_needs_from_estimate(
                    db, project_id, actor_id=contractor_id,
                )
                return len(created)

        counts = await asyncio.gather(generate_once(), generate_once())
        assert sorted(counts) == [0, 1]

        async with Session() as db:
            pick_count = await db.scalar(
                select(func.count()).select_from(MaterialPick).where(MaterialPick.project_id == project_id)
            )
            assert pick_count == 1
    finally:
        await engine.dispose()
