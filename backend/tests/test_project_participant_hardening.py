"""Regression proof for warm ORM sessions, atomic conversion and recovery."""
from __future__ import annotations

import asyncio
from datetime import date
import os
import uuid
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.api.deps import get_current_user
from app.api.v1 import marketplace_conversion_integrity as conversion_api
from app.db.session import get_db
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, JobLead, JobLeadStatus, Project, Room, Stage, User, UserRole
from app.models.project_participants import ProjectParticipant, ProjectParticipantEvent
from app.services import marketplace_conversion_service as conversion
from app.services import outbox_inline_dispatch, project_assignment_service as assignment
from app.services import project_create_service as creation
from app.services import project_participant_service as participants
from app.services.client_write_idempotency import IdempotencyConflict


def _user(role):
    token = uuid.uuid4()
    return User(id=str(token), phone=f"+7{token.int % 10**10:010d}", role=role)


async def _users(db):
    owner, other = _user(UserRole.customer), _user(UserRole.customer)
    first, second = _user(UserRole.contractor), _user(UserRole.contractor)
    db.add_all([owner, other, first, second])
    await db.flush()
    return owner, other, first, second


async def _project(db):
    owner, other, first, second = await _users(db)
    project = Project(id=str(uuid.uuid4()), name="Warm session", customer_id=owner.id, renovation_type="cosmetic")
    db.add(project)
    await db.flush()
    stage = Stage(id=str(uuid.uuid4()), project_id=project.id, name="Electrical", sort_order=0, work_type="electrical")
    db.add(stage)
    await db.commit()
    return owner, other, first, second, project, stage


async def _lead(db):
    owner, other, first, second = await _users(db)
    lead = JobLead(
        id=str(uuid.uuid4()), customer_id=owner.id, assigned_contractor_id=first.id,
        title="Conversion regression", area_sqm=12, budget_hint=100000,
        renovation_type="cosmetic", status=JobLeadStatus.quoted,
    )
    db.add(lead)
    await db.commit()
    return owner, other, first, second, lead


def _rooms():
    return [{"name": "Room", "length_m": 4, "width_m": 3, "height_m": 2.7}]


@pytest.mark.asyncio
async def test_assignment_refreshes_warm_project_instead_of_overwriting_winner(db, monkeypatch):
    owner, _, first, second, project, _ = await _project(db)
    project_id, owner_id, first_id, second_id = project.id, owner.id, first.id, second.id
    monkeypatch.setattr(assignment.settings, "contractor_free_project_limit", 99)
    await db.execute(update(Project).where(Project.id == project_id).values(
        contractor_id=first_id,
    ).execution_options(synchronize_session=False))
    await db.commit()
    assert project.contractor_id is None  # identity map deliberately contains the old value
    result = await assignment.assign_contractor(
        db, project_id=project_id, contractor_id=second_id, actor_id=owner_id,
    )
    assert result.status == "already_assigned"
    assert result.current_contractor_id == first_id
    assert await db.scalar(select(Project.contractor_id).where(Project.id == project_id)) == first_id
    assert await db.scalar(select(func.count()).select_from(ProjectParticipantEvent)) == 0


@pytest.mark.asyncio
async def test_owner_change_is_revalidated_at_both_write_boundaries(db):
    owner, other, first, _, project, stage = await _project(db)
    project_id, owner_id, other_id, first_id, stage_id = project.id, owner.id, other.id, first.id, stage.id
    await db.execute(update(Project).where(Project.id == project_id).values(
        customer_id=other_id,
    ).execution_options(synchronize_session=False))
    await db.commit()
    assert project.customer_id == owner_id
    result = await assignment.assign_contractor(
        db, project_id=project_id, contractor_id=first_id, actor_id=owner_id,
    )
    assert result.status == "forbidden"
    with pytest.raises(ValueError, match="participant_customer_owner_only"):
        await participants.add_or_reactivate_contractor(
            db, project_id=project_id, actor_id=owner_id, contractor_id=first_id,
            scopes=[("stage", stage_id)],
        )
    assert await db.scalar(select(func.count()).select_from(ProjectParticipant)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["remove", "scope"])
async def test_preloaded_independent_cannot_modify_promoted_current_lead(db, operation):
    owner, _, first, _, project, stage = await _project(db)
    owner_id, project_id, first_id, stage_id = owner.id, project.id, first.id, stage.id
    participant, _ = await participants.add_or_reactivate_contractor(
        db, project_id=project_id, actor_id=owner_id, contractor_id=first_id,
        scopes=[("stage", stage_id)],
    )
    participant_id = participant.id
    await db.execute(update(Project).where(Project.id == project_id).values(
        contractor_id=first_id,
    ).execution_options(synchronize_session=False))
    await db.execute(update(ProjectParticipant).where(ProjectParticipant.id == participant_id).values(
        participant_role="lead_contractor", all_scope=True,
    ).execution_options(synchronize_session=False))
    await db.commit()
    assert participant.participant_role == "contractor"
    with pytest.raises(ValueError, match="participant_legacy_lead"):
        if operation == "remove":
            await participants.remove_contractor(db, project_id=project_id, participant_id=participant_id, actor_id=owner_id)
        else:
            await participants.replace_scopes(db, project_id=project_id, participant_id=participant_id, actor_id=owner_id, scopes=[])
    assert await db.scalar(select(ProjectParticipant.status).where(ProjectParticipant.id == participant_id)) == "active"
    assert await db.scalar(select(func.count()).select_from(ProjectParticipantEvent)) == 1


@pytest.mark.asyncio
async def test_former_lead_reactivation_is_independent_and_deny_default(db):
    owner, _, first, second, project, stage = await _project(db)
    original = await participants.sync_current_lead_in_transaction(db, project=project, contractor_id=first.id, actor_id=owner.id)
    original_id = original.id
    await db.commit()
    await participants.sync_current_lead_in_transaction(db, project=project, contractor_id=second.id, actor_id=owner.id)
    await db.commit()
    revived, created = await participants.add_or_reactivate_contractor(
        db, project_id=project.id, actor_id=owner.id, contractor_id=first.id,
        scopes=[("stage", stage.id)],
    )
    assert revived.id == original_id and created is False
    assert revived.participant_role == "contractor"
    assert not any((revived.all_scope, revived.can_manage_schedule, revived.can_manage_commercial, revived.can_manage_documents))
    assert await participants.scope_allows(db, project=project, user_id=first.id, stage_id=stage.id)
    assert not await participants.scope_allows(db, project=project, user_id=first.id)
    assert await db.scalar(select(func.count()).select_from(ProjectParticipantEvent).where(
        ProjectParticipantEvent.participant_id == original_id,
    )) == 3


@pytest.mark.asyncio
async def test_cached_old_lead_does_not_grant_scope(db):
    owner, _, first, second, project, stage = await _project(db)
    await participants.sync_current_lead_in_transaction(db, project=project, contractor_id=first.id, actor_id=owner.id)
    await db.commit()
    await db.execute(update(Project).where(Project.id == project.id).values(
        contractor_id=second.id,
    ).execution_options(synchronize_session=False))
    await db.commit()
    assert project.contractor_id == first.id
    assert not await participants.stage_assignee_allowed(db, project=project, stage=stage, user_id=first.id)


@pytest.mark.asyncio
async def test_participant_audit_failure_rolls_back_all_rows(db, monkeypatch):
    owner, _, first, _, project, stage = await _project(db)
    owner_id, first_id, project_id, stage_id = owner.id, first.id, project.id, stage.id
    monkeypatch.setattr(participants, "_record_event", AsyncMock(side_effect=RuntimeError("audit failure")))
    with pytest.raises(RuntimeError, match="audit failure"):
        await participants.add_or_reactivate_contractor(
            db, project_id=project_id, actor_id=owner_id, contractor_id=first_id,
            scopes=[("stage", stage_id)],
        )
    assert not db.in_transaction()
    assert await db.scalar(select(func.count()).select_from(ProjectParticipant)) == 0


@pytest.mark.asyncio
async def test_conversion_replays_after_midnight_and_across_authorized_actors(db, monkeypatch):
    owner, _, contractor, _, lead = await _lead(db)
    owner_id, contractor_id, lead_id = owner.id, contractor.id, lead.id
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock())
    first = await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    project_id, original_start = first.project.id, first.project.planned_start_date
    class Tomorrow(date):
        @classmethod
        def today(cls):
            return date(2031, 1, 1)
    monkeypatch.setattr(creation, "date", Tomorrow)
    second = await conversion.convert_lead(db, lead_id=lead_id, actor_id=contractor_id, rooms_data=_rooms(), property_type="apartment")
    assert first.replayed is False and second.replayed is True
    assert second.project.id == project_id and second.project.planned_start_date == original_start
    assert await db.scalar(select(JobLead.status).where(JobLead.id == lead_id)) == JobLeadStatus.taken
    for model in (Project, ProjectParticipant, ProjectParticipantEvent, ClientWriteRequest, DomainOutbox):
        assert await db.scalar(select(func.count()).select_from(model)) == 1


@pytest.mark.asyncio
async def test_conversion_commit_failure_leaves_no_partial_project_or_taken_lead(db, monkeypatch):
    owner, _, _, _, lead = await _lead(db)
    owner_id, lead_id = owner.id, lead.id
    async def fail_commit(session, **kwargs):
        await session.flush()
        raise RuntimeError("commit boundary failure")
    monkeypatch.setattr(conversion, "commit_client_write", fail_commit)
    with pytest.raises(RuntimeError, match="commit boundary failure"):
        await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    assert not db.in_transaction()
    assert await db.scalar(select(JobLead.status).where(JobLead.id == lead_id)) == JobLeadStatus.quoted
    for model in (Project, Room, Stage, ProjectParticipant, ProjectParticipantEvent, ClientWriteRequest, DomainOutbox):
        assert await db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.asyncio
async def test_conversion_recovers_after_commit_response_loss_without_duplicate(db, monkeypatch):
    owner, _, _, _, lead = await _lead(db)
    owner_id, lead_id = owner.id, lead.id
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock(side_effect=RuntimeError("response lost")))
    with pytest.raises(RuntimeError, match="response lost"):
        await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock())
    recovered = await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    assert recovered.replayed is True
    assert await db.scalar(select(func.count()).select_from(Project)) == 1
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 1


@pytest.mark.asyncio
async def test_conversion_replay_reauthorizes_and_rejects_changed_intent(db, monkeypatch):
    owner, outsider, _, _, lead = await _lead(db)
    owner_id, outsider_id, lead_id = owner.id, outsider.id, lead.id
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock())
    await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    with pytest.raises(ValueError, match="lead_owner_only"):
        await conversion.convert_lead(db, lead_id=lead_id, actor_id=outsider_id, rooms_data=_rooms(), property_type="apartment")
    with pytest.raises(IdempotencyConflict):
        await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="house")
    assert await db.scalar(select(func.count()).select_from(Project)) == 1


@pytest.mark.asyncio
async def test_taken_lead_without_ledger_fails_closed(db):
    owner, _, _, _, lead = await _lead(db)
    owner_id, lead_id = owner.id, lead.id
    lead.status = JobLeadStatus.taken
    await db.commit()
    with pytest.raises(ValueError, match="lead_conversion_record_missing"):
        await conversion.convert_lead(db, lead_id=lead_id, actor_id=owner_id, rooms_data=_rooms(), property_type="apartment")
    assert await db.scalar(select(func.count()).select_from(Project)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"rooms": ["bad"]}, {"rooms": []}, {"property_type": " "}, {"rooms": [{"name": "Room", "length_m": -1, "width_m": 3}]}])
async def test_conversion_http_schema_rejects_malformed_input_without_writes(db, body):
    owner, _, _, _, lead = await _lead(db)
    app = FastAPI()
    app.include_router(conversion_api.router, prefix="/api/v1")
    async def override_db():
        yield db
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: owner
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(f"/api/v1/job-leads/{lead.id}/convert", json=body)
    assert response.status_code == 422
    assert await db.scalar(select(func.count()).select_from(Project)) == 0


def test_conversion_room_rejects_nonfinite_dimensions():
    for value in (float("inf"), float("nan")):
        with pytest.raises(ValidationError):
            conversion_api.ConversionRoomIn(name="Room", length_m=value, width_m=3)


def _postgres_session():
    url = os.environ.get("PROJECT_PARTICIPANT_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("Dedicated PostgreSQL workflow only")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"
    engine = create_async_engine(url)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@pytest.mark.asyncio
async def test_postgres_warm_two_session_assignment_keeps_one_winner(monkeypatch):
    engine, Session = _postgres_session()
    monkeypatch.setattr(assignment.settings, "contractor_free_project_limit", 99)
    try:
        async with Session() as db:
            owner, _, first, second, project, _ = await _project(db)
            owner_id, project_id, first_id, second_id = owner.id, project.id, first.id, second.id
        barrier = asyncio.Barrier(2)
        async def assign_once(contractor_id):
            async with Session() as db:
                warm_project = await db.get(Project, project_id)
                assert warm_project.contractor_id is None
                await barrier.wait()
                result = await assignment.assign_contractor(db, project_id=project_id, contractor_id=contractor_id, actor_id=owner_id)
                return result.status, result.current_contractor_id
        results = await asyncio.wait_for(asyncio.gather(assign_once(first_id), assign_once(second_id)), timeout=30)
        assert sorted(result[0] for result in results) == ["already_assigned", "assigned"]
        assert results[0][1] == results[1][1]
        async with Session() as db:
            assert await db.scalar(select(func.count()).select_from(ProjectParticipantEvent).where(
                ProjectParticipantEvent.project_id == project_id,
            )) == 1
            assert await db.scalar(select(Project.contractor_id).where(Project.id == project_id)) == results[0][1]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_postgres_warm_customer_contractor_conversion_returns_one_project():
    engine, Session = _postgres_session()
    try:
        async with Session() as db:
            owner, _, contractor, _, lead = await _lead(db)
            owner_id, contractor_id, lead_id = owner.id, contractor.id, lead.id
        barrier = asyncio.Barrier(2)
        async def convert_once(actor_id):
            async with Session() as db:
                warm_lead = await db.get(JobLead, lead_id)
                assert warm_lead.status == JobLeadStatus.quoted
                await barrier.wait()
                result = await conversion.convert_lead(db, lead_id=lead_id, actor_id=actor_id, rooms_data=_rooms(), property_type="apartment")
                return result.project.id, result.replayed
        results = await asyncio.wait_for(asyncio.gather(convert_once(owner_id), convert_once(contractor_id)), timeout=45)
        assert results[0][0] == results[1][0]
        assert sorted(result[1] for result in results) == [False, True]
        async with Session() as db:
            assert await db.scalar(select(func.count()).select_from(Project).where(Project.customer_id == owner_id)) == 1
            assert await db.scalar(select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.request_id == f"marketplace-lead:{lead_id}",
            )) == 1
            assert await db.scalar(select(func.count()).select_from(ProjectParticipantEvent).where(
                ProjectParticipantEvent.project_id == results[0][0],
            )) == 1
            assert await db.scalar(select(JobLead.status).where(JobLead.id == lead_id)) == JobLeadStatus.taken
    finally:
        await engine.dispose()
