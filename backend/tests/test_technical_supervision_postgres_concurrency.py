from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models.technical_supervision  # noqa: F401
from app.models.entities import Project, User, UserRole
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.services import technical_supervision_service as supervision


async def _no_dispatch(*_args, **_kwargs):
    return None


def _postgres_url() -> str:
    value = os.environ.get("TECHNICAL_SUPERVISION_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip(
            "TECHNICAL_SUPERVISION_POSTGRES_URL is only set by the dedicated PostgreSQL workflow"
        )
    return value


async def _seed_user(session, *, user_id: str, phone: str, role: UserRole, profile_code: str) -> None:
    session.add(
        User(
            id=user_id,
            phone=phone,
            role=role,
            full_name=user_id,
            profile_code=profile_code,
        )
    )


@pytest.mark.asyncio
async def test_same_supervisor_concurrent_appointment_is_single_row_and_replay(monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    engine = create_async_engine(_postgres_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            await _seed_user(
                db,
                user_id="ts-pg-owner-same",
                phone="+79770000001",
                role=UserRole.customer,
                profile_code="PGOWN01",
            )
            await _seed_user(
                db,
                user_id="ts-pg-supervisor-same",
                phone="+79770000002",
                role=UserRole.contractor,
                profile_code="PGSUP01",
            )
            db.add(
                Project(
                    id="ts-pg-project-same",
                    name="Concurrent same supervisor",
                    renovation_type="capital",
                    property_type="apartment",
                    customer_id="ts-pg-owner-same",
                )
            )
            await db.commit()

        async def appoint_once():
            async with session_factory() as db:
                actor = await db.get(User, "ts-pg-owner-same")
                assert actor is not None
                return await supervision.appoint_or_replace(
                    db,
                    project_id="ts-pg-project-same",
                    actor=actor,
                    profile_code="PGSUP01",
                    provider_type="individual",
                    provider_name="Independent inspector",
                )

        first, second = await asyncio.gather(appoint_once(), appoint_once())
        assert sorted([first.replayed, second.replayed]) == [False, True]
        assert first.assignment is not None
        assert second.assignment is not None
        assert first.assignment.id == second.assignment.id

        async with session_factory() as db:
            total = await db.scalar(
                select(func.count())
                .select_from(ProjectTechnicalSupervisorAssignment)
                .where(ProjectTechnicalSupervisorAssignment.project_id == "ts-pg-project-same")
            )
            active = await db.scalar(
                select(func.count())
                .select_from(ProjectTechnicalSupervisorAssignment)
                .where(
                    ProjectTechnicalSupervisorAssignment.project_id == "ts-pg-project-same",
                    ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
                )
            )
        assert total == 1
        assert active == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_different_supervisors_concurrent_appointments_serialize_to_one_active(monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    engine = create_async_engine(_postgres_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            await _seed_user(
                db,
                user_id="ts-pg-owner-replace",
                phone="+79770000003",
                role=UserRole.customer,
                profile_code="PGOWN02",
            )
            await _seed_user(
                db,
                user_id="ts-pg-supervisor-a",
                phone="+79770000004",
                role=UserRole.contractor,
                profile_code="PGSUP02",
            )
            await _seed_user(
                db,
                user_id="ts-pg-supervisor-b",
                phone="+79770000005",
                role=UserRole.contractor,
                profile_code="PGSUP03",
            )
            db.add(
                Project(
                    id="ts-pg-project-replace",
                    name="Concurrent supervisor replacement",
                    renovation_type="capital",
                    property_type="apartment",
                    customer_id="ts-pg-owner-replace",
                )
            )
            await db.commit()

        async def appoint(profile_code: str):
            async with session_factory() as db:
                actor = await db.get(User, "ts-pg-owner-replace")
                assert actor is not None
                return await supervision.appoint_or_replace(
                    db,
                    project_id="ts-pg-project-replace",
                    actor=actor,
                    profile_code=profile_code,
                    provider_type="individual",
                    provider_name=profile_code,
                )

        first, second = await asyncio.gather(appoint("PGSUP02"), appoint("PGSUP03"))
        assert first.replayed is False
        assert second.replayed is False

        async with session_factory() as db:
            rows = (
                await db.execute(
                    select(ProjectTechnicalSupervisorAssignment)
                    .where(
                        ProjectTechnicalSupervisorAssignment.project_id
                        == "ts-pg-project-replace"
                    )
                    .order_by(ProjectTechnicalSupervisorAssignment.appointed_at)
                )
            ).scalars().all()
        assert len(rows) == 2
        assert sum(row.revoked_at is None for row in rows) == 1
        assert sum(row.revoked_at is not None for row in rows) == 1
        assert rows[1].supersedes_assignment_id == rows[0].id
    finally:
        await engine.dispose()
