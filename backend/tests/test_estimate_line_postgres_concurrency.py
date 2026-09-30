"""#406: real PostgreSQL race proof for estimate-line create replay.

An in-memory SQLite unit test cannot prove the ClientWriteRequest unique
constraint actually serializes two truly concurrent same-key create attempts
into one committed row — that only shows up under a real database with two
independent connections racing the same INSERT. This reproduces the offline
queue's response-loss retry as two concurrent requests carrying the exact
same client_request_id and payload, against a real (migrated) PostgreSQL
instance, and asserts they collapse into exactly one EstimateLine with
budget_planned counted exactly once.
"""
from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import EstimateLine, Project, User, UserRole
from app.services import estimate_service


def _postgres_url() -> str:
    value = os.environ.get("ESTIMATE_LINE_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("ESTIMATE_LINE_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


@pytest.mark.asyncio
async def test_concurrent_same_request_collapses_to_one_line_and_one_budget_sync():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "estline-race-customer"
    contractor_id = "estline-race-contractor"
    project_id = "estline-race-project"
    request_id = "estline-race-request-0001"
    payload = {
        "line_type": "material",
        "name": "Керамогранит",
        "unit": "m2",
        "quantity_planned": 24.5,
        "unit_price": 4200.0,
        "room_id": None,
        "room_name": None,
        "category": None,
        "notes": None,
    }
    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone="+79663340001", role=UserRole.customer, full_name="Race customer"),
                User(id=contractor_id, phone="+79663340002", role=UserRole.contractor, full_name="Race contractor"),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="Estimate line race", renovation_type="cosmetic",
                customer_id=customer_id, contractor_id=contractor_id,
                budget_planned=0, budget_spent=0,
            ))
            await db.commit()

        async def create_once():
            async with Session() as db:
                line, replayed = await estimate_service.create_or_replay_estimate_line(
                    db,
                    project_id=project_id,
                    user_id=contractor_id,
                    payload=payload,
                    client_request_id=request_id,
                )
                return line.id, replayed

        (id_a, replayed_a), (id_b, replayed_b) = await asyncio.gather(create_once(), create_once())
        assert id_a == id_b
        # Exactly one of the two concurrent attempts must be the original
        # create; the other must observe the replay.
        assert {replayed_a, replayed_b} == {False, True}

        async with Session() as db:
            line_count = await db.scalar(
                select(func.count()).select_from(EstimateLine).where(EstimateLine.project_id == project_id)
            )
            assert line_count == 1

            request_count = await db.scalar(
                select(func.count()).select_from(ClientWriteRequest).where(
                    ClientWriteRequest.scope == estimate_service.ESTIMATE_LINE_CREATE_SCOPE,
                    ClientWriteRequest.project_id == project_id,
                    ClientWriteRequest.user_id == contractor_id,
                    ClientWriteRequest.request_id == request_id,
                )
            )
            assert request_count == 1

            project = await db.get(Project, project_id)
            # budget_planned must reflect the single surviving line exactly
            # once, never doubled by the losing concurrent attempt.
            assert float(project.budget_planned) == pytest.approx(24.5 * 4200.0)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_same_key_changed_payload_one_wins_one_conflicts():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "estline-race2-customer"
    contractor_id = "estline-race2-contractor"
    project_id = "estline-race2-project"
    request_id = "estline-race2-request-0001"
    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone="+79663350001", role=UserRole.customer, full_name="Race2 customer"),
                User(id=contractor_id, phone="+79663350002", role=UserRole.contractor, full_name="Race2 contractor"),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="Estimate line race 2", renovation_type="cosmetic",
                customer_id=customer_id, contractor_id=contractor_id,
                budget_planned=0, budget_spent=0,
            ))
            await db.commit()

        async def create_with(name: str):
            async with Session() as db:
                return await estimate_service.create_or_replay_estimate_line(
                    db,
                    project_id=project_id,
                    user_id=contractor_id,
                    payload={
                        "line_type": "material",
                        "name": name,
                        "unit": "pcs",
                        "quantity_planned": 1,
                        "unit_price": 100.0,
                        "room_id": None,
                        "room_name": None,
                        "category": None,
                        "notes": None,
                    },
                    client_request_id=request_id,
                )

        results = await asyncio.gather(
            create_with("Плитка"), create_with("Ламинат"), return_exceptions=True
        )
        from app.services.client_write_idempotency import IdempotencyConflict

        successes = [r for r in results if not isinstance(r, BaseException)]
        conflicts = [r for r in results if isinstance(r, IdempotencyConflict)]
        assert len(successes) == 1
        assert len(conflicts) == 1

        async with Session() as db:
            line_count = await db.scalar(
                select(func.count()).select_from(EstimateLine).where(EstimateLine.project_id == project_id)
            )
            assert line_count == 1
    finally:
        await engine.dispose()
