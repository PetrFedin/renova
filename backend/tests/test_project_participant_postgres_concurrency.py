"""Real PostgreSQL race proof for project participant foundation and lead assignment."""
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
from app.services import project_assignment_service as assignment_service
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


async def _seed_assignment_race(Session):
    customer_id = "pp-assign-customer"
    first_id = "pp-assign-first"
    second_id = "pp-assign-second"
    project_id = "pp-assign-project"
    async with Session() as db:
        db.add_all(
            [
                User(
                    id=customer_id,
                    phone="+79991110101",
                    role=UserRole.customer,
                ),
                User(
                    id=first_id,
                    phone="+79991110102",
                    role=UserRole.contractor,
                ),
                User(
                    id=second_id,
                    phone="+79991110103",
                    role=UserRole.contractor,
                ),
            ]
        )
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Lead assignment race",
                renovation_type="cosmetic",
                customer_id=customer_id,
            )
        )
        await db.commit()
    return customer_id, first_id, second_id, project_id


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


@pytest.mark.asyncio
async def test_concurrent_different_contractors_collapse_to_one_current_lead(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id, first_id, second_id, project_id = await _seed_assignment_race(Session)
    monkeypatch.setattr(
        assignment_service.settings,
        "contractor_free_project_limit",
        99,
    )

    async def assign_once(contractor_id: str):
        async with Session() as db:
            result = await assignment_service.assign_contractor(
                db,
                project_id=project_id,
                contractor_id=contractor_id,
                actor_id=contractor_id,
            )
            return result.status, result.current_contractor_id

    try:
        first, second = await asyncio.gather(assign_once(first_id), assign_once(second_id))
        statuses = sorted([first[0], second[0]])
        assert statuses == ["already_assigned", "assigned"]

        async with Session() as db:
            project = await db.get(Project, project_id)
            assert project is not None
            winner = project.contractor_id
            assert winner in {first_id, second_id}
            loser = second_id if winner == first_id else first_id

            active_leads = list(
                (
                    await db.execute(
                        select(ProjectParticipant).where(
                            ProjectParticipant.project_id == project_id,
                            ProjectParticipant.status == "active",
                            ProjectParticipant.participant_role == "lead_contractor",
                        )
                    )
                ).scalars().all()
            )
            assert len(active_leads) == 1
            assert active_leads[0].user_id == winner
            assert active_leads[0].all_scope is True
            assert active_leads[0].can_manage_schedule is True
            assert active_leads[0].can_manage_commercial is True
            assert active_leads[0].can_manage_documents is True

            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(ProjectParticipant)
                    .where(
                        ProjectParticipant.project_id == project_id,
                        ProjectParticipant.user_id == loser,
                    )
                )
                or 0
            ) == 0
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(ProjectParticipantEvent)
                    .where(
                        ProjectParticipantEvent.project_id == project_id,
                        ProjectParticipantEvent.event_type == "added",
                    )
                )
                or 0
            ) == 1
    finally:
        await engine.dispose()
