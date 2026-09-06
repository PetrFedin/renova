"""Real PostgreSQL race proof for project participant foundation."""
from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.entities import Project, Stage, User, UserRole
from app.models.project_participants import (
    ProjectParticipant,
    ProjectParticipantEvent,
    ProjectParticipantScope,
)
from app.services import project_participant_service as participant_service


def _postgres_url() -> str:
    value = os.environ.get("PROJECT_PARTICIPANT_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("PROJECT_PARTICIPANT_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    return value


async def _seed(Session):
    customer_id = "pp-race-customer"
    contractor_id = "pp-race-independent"
    project_id = "pp-race-project"
    stage_id = "pp-race-stage"
    async with Session() as db:
        db.add_all(
            [
                User(
                    id=customer_id,
                    phone="+79991110001",
                    role=UserRole.customer,
                ),
                User(
                    id=contractor_id,
                    phone="+79991110002",
                    role=UserRole.contractor,
                ),
            ]
        )
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Participant race",
                renovation_type="cosmetic",
                customer_id=customer_id,
            )
        )
        await db.flush()
        db.add(
            Stage(
                id=stage_id,
                project_id=project_id,
                name="Electrical",
                sort_order=0,
                work_type="electrical",
            )
        )
        await db.commit()
    return customer_id, contractor_id, project_id, stage_id


@pytest.mark.asyncio
async def test_concurrent_same_participant_and_scope_collapses_to_one_authoritative_row():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id, contractor_id, project_id, stage_id = await _seed(Session)

    async def add_once():
        async with Session() as db:
            participant, created = await participant_service.add_or_reactivate_contractor(
                db,
                project_id=project_id,
                actor_id=customer_id,
                contractor_id=contractor_id,
                scopes=[("stage", stage_id)],
            )
            return participant.id, created

    try:
        first, second = await asyncio.gather(add_once(), add_once())
        assert first[0] == second[0]
        assert sorted([first[1], second[1]]) == [False, True]
        async with Session() as db:
            participant_count = int(
                await db.scalar(
                    select(func.count())
                    .select_from(ProjectParticipant)
                    .where(
                        ProjectParticipant.project_id == project_id,
                        ProjectParticipant.user_id == contractor_id,
                    )
                )
                or 0
            )
            scope_count = int(
                await db.scalar(
                    select(func.count())
                    .select_from(ProjectParticipantScope)
                    .join(
                        ProjectParticipant,
                        ProjectParticipant.id == ProjectParticipantScope.participant_id,
                    )
                    .where(
                        ProjectParticipant.project_id == project_id,
                        ProjectParticipant.user_id == contractor_id,
                    )
                )
                or 0
            )
            event_count = int(
                await db.scalar(
                    select(func.count())
                    .select_from(ProjectParticipantEvent)
                    .where(
                        ProjectParticipantEvent.project_id == project_id,
                        ProjectParticipantEvent.user_id == contractor_id,
                        ProjectParticipantEvent.event_type == "added",
                    )
                )
                or 0
            )
            assert participant_count == 1
            assert scope_count == 1
            assert event_count == 1
    finally:
        await engine.dispose()
