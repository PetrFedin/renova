"""P0 #316: work-schedule create and review transitions are replay-safe."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.project_work_schedule import (
    WorkScheduleCreateCommand,
    confirm_project_work_schedule,
    create_project_work_schedule,
    reject_project_work_schedule,
    submit_project_work_schedule,
)
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, User, UserRole
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem, WorkScheduleStatus
from app.schemas.project_work_schedule import WorkScheduleItemIn, WorkScheduleRejectIn
from app.services import project_work_schedule_service as schedule_service

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990007101", role=UserRole.customer, full_name="Schedule customer")
    contractor = User(phone="+79990007102", role=UserRole.contractor, full_name="Schedule contractor")
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name="Schedule replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.commit()
    return customer, contractor, project


def _body(request_id: str, *, title: str = "План-график") -> WorkScheduleCreateCommand:
    start = date.today() + timedelta(days=1)
    finish = start + timedelta(days=2)
    return WorkScheduleCreateCommand(
        title=title,
        planned_start_date=start,
        planned_finish_date=finish,
        items=[
            WorkScheduleItemIn(
                title="Подготовка",
                planned_start_date=start,
                planned_finish_date=finish,
                requires_customer_acceptance=True,
                requires_photo=True,
            )
        ],
        client_request_id=request_id,
    )


async def _no_dispatch(*_args, **_kwargs):
    return None


async def _effect_count(db, schedule_id: str) -> int:
    return int(await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "work_schedule",
            DomainOutbox.aggregate_id == schedule_id,
        )
    ) or 0)


async def test_work_schedule_response_loss_replay_returns_one_schedule_graph(db):
    _, contractor, project = await _fixture(db)
    body = _body("schedule-response-loss-0001")

    first = await create_project_work_schedule(project.id, body, db=db, user=contractor)
    replay = await create_project_work_schedule(project.id, body, db=db, user=contractor)

    assert replay.id == first.id
    assert len(first.items) == 1
    assert len(replay.items) == 1

    schedule_count = await db.scalar(
        select(func.count()).select_from(ProjectWorkSchedule).where(ProjectWorkSchedule.project_id == project.id)
    )
    item_count = await db.scalar(
        select(func.count()).select_from(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.project_id == project.id)
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "work_schedule.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == contractor.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert schedule_count == 1
    assert item_count == 1
    assert ledger_count == 1


async def test_work_schedule_same_request_id_different_payload_conflicts(db):
    _, contractor, project = await _fixture(db)
    request_id = "schedule-conflict-0001"
    await create_project_work_schedule(project.id, _body(request_id), db=db, user=contractor)

    with pytest.raises(HTTPException) as exc_info:
        await create_project_work_schedule(
            project.id,
            _body(request_id, title="Другой график"),
            db=db,
            user=contractor,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    schedule_count = await db.scalar(
        select(func.count()).select_from(ProjectWorkSchedule).where(ProjectWorkSchedule.project_id == project.id)
    )
    assert schedule_count == 1


async def test_customer_cannot_create_schedule_when_contractor_is_assigned(db):
    customer, _, project = await _fixture(db)
    with pytest.raises(HTTPException) as exc_info:
        await create_project_work_schedule(
            project.id,
            _body("schedule-customer-forbidden-0001"),
            db=db,
            user=customer,
        )
    assert exc_info.value.status_code == 403


async def test_submit_and_confirm_replay_without_duplicate_effects_or_downgrade(db, monkeypatch):
    customer, contractor, project = await _fixture(db)
    monkeypatch.setattr(schedule_service, "_dispatch_schedule_effects", _no_dispatch)
    schedule = await create_project_work_schedule(
        project.id,
        _body("schedule-review-replay-0001"),
        db=db,
        user=contractor,
    )

    submitted = await submit_project_work_schedule(project.id, schedule.id, db=db, user=contractor)
    assert submitted.status == WorkScheduleStatus.submitted
    submit_effects = await _effect_count(db, schedule.id)
    assert submit_effects == 2

    submit_replay = await submit_project_work_schedule(project.id, schedule.id, db=db, user=contractor)
    assert submit_replay.status == WorkScheduleStatus.submitted
    assert await _effect_count(db, schedule.id) == submit_effects

    confirmed = await confirm_project_work_schedule(project.id, schedule.id, db=db, user=customer)
    assert confirmed.status == WorkScheduleStatus.confirmed
    confirmed_effects = await _effect_count(db, schedule.id)
    assert confirmed_effects == submit_effects + 2

    confirm_replay = await confirm_project_work_schedule(project.id, schedule.id, db=db, user=customer)
    assert confirm_replay.status == WorkScheduleStatus.confirmed
    assert await _effect_count(db, schedule.id) == confirmed_effects

    with pytest.raises(HTTPException) as exc_info:
        await submit_project_work_schedule(project.id, schedule.id, db=db, user=contractor)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "schedule_submit_transition_forbidden"

    persisted = await db.get(ProjectWorkSchedule, schedule.id)
    assert persisted is not None
    assert persisted.status == WorkScheduleStatus.confirmed
    assert await _effect_count(db, schedule.id) == confirmed_effects


async def test_reject_replay_requires_same_reason_and_has_one_effect_set(db, monkeypatch):
    customer, contractor, project = await _fixture(db)
    monkeypatch.setattr(schedule_service, "_dispatch_schedule_effects", _no_dispatch)
    schedule = await create_project_work_schedule(
        project.id,
        _body("schedule-reject-replay-0001"),
        db=db,
        user=contractor,
    )
    await submit_project_work_schedule(project.id, schedule.id, db=db, user=contractor)
    submit_effects = await _effect_count(db, schedule.id)

    reason = "Сдвиньте электрику на два дня"
    rejected = await reject_project_work_schedule(
        project.id,
        schedule.id,
        WorkScheduleRejectIn(reason=reason),
        db=db,
        user=customer,
    )
    assert rejected.status == WorkScheduleStatus.rejected
    rejected_effects = await _effect_count(db, schedule.id)
    assert rejected_effects == submit_effects + 2

    replay = await reject_project_work_schedule(
        project.id,
        schedule.id,
        WorkScheduleRejectIn(reason=reason),
        db=db,
        user=customer,
    )
    assert replay.status == WorkScheduleStatus.rejected
    assert await _effect_count(db, schedule.id) == rejected_effects

    with pytest.raises(HTTPException) as exc_info:
        await reject_project_work_schedule(
            project.id,
            schedule.id,
            WorkScheduleRejectIn(reason="Другая причина"),
            db=db,
            user=customer,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "schedule_already_rejected"
    assert await _effect_count(db, schedule.id) == rejected_effects
