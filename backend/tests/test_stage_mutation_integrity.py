from __future__ import annotations

from datetime import date
import json

import pytest
from fastapi import HTTPException
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select

import app.models.client_write_request  # noqa: F401
from app.api.v1 import stage_mutations
from app.api.v1 import stages_ext
from app.main import app
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    DomainOutbox,
    Project,
    Room,
    Stage,
    StagePhoto,
    StageStatus,
    Team,
    TeamMember,
    User,
    UserRole,
    WorkAcceptance,
    WorkDependency,
)
from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
from app.services import dependency_service
from app.services import project_document_service
from app.services import stage_mutation_service as mutations


async def seed_stage_project(db, suffix: str):
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    customer = User(
        id=f"stage-mutation-customer-{suffix}",
        phone=f"+7601{tail:07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"stage-mutation-contractor-{suffix}",
        phone=f"+7602{tail:07d}",
        role=UserRole.contractor,
    )
    foreman = User(
        id=f"stage-mutation-foreman-{suffix}",
        phone=f"+7603{tail:07d}",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"stage-mutation-outsider-{suffix}",
        phone=f"+7604{tail:07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"stage-mutation-project-{suffix}",
        name="Stage mutation integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        planned_start_date=date(2026, 8, 1),
        planned_end_date=date(2026, 10, 31),
    )
    team = Team(
        id=f"stage-mutation-team-{suffix}",
        name="Stage mutation team",
        owner_id=contractor.id,
    )
    foreman_membership = TeamMember(
        id=f"stage-mutation-foreman-member-{suffix}",
        team_id=team.id,
        user_id=foreman.id,
        role="foreman",
    )
    room = Room(
        id=f"stage-mutation-room-{suffix}",
        project_id=project.id,
        name="Гостиная",
        room_type="living",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    stage = Stage(
        id=f"stage-mutation-stage-{suffix}",
        project_id=project.id,
        name="Подготовка стен",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        assignee_id=contractor.id,
        planned_start=date(2026, 8, 2),
        planned_end=date(2026, 8, 10),
        room_ids_json=json.dumps([room.id]),
    )
    predecessor = Stage(
        id=f"stage-mutation-predecessor-{suffix}",
        project_id=project.id,
        name="Демонтаж",
        sort_order=1,
        status=StageStatus.planned,
        percent_complete=0,
        assignee_id=contractor.id,
        planned_start=date(2026, 8, 11),
        planned_end=date(2026, 8, 15),
    )
    db.add_all(
        [
            customer, contractor, foreman, outsider, project, team,
            foreman_membership, room, stage, predecessor,
        ]
    )
    await db.commit()
    return customer, contractor, foreman, outsider, project, room, stage, predecessor


@pytest.mark.asyncio
async def test_stage_create_is_atomic_replay_safe_and_rejects_foreign_rooms(db):
    _, contractor, _, _, project, room, _, _ = await seed_stage_project(db, "create")
    project_id = project.id
    contractor_id = contractor.id
    room_id = room.id
    foreign_customer = User(
        id="stage-foreign-customer",
        phone="+76050000001",
        role=UserRole.customer,
    )
    foreign_project = Project(
        id="stage-foreign-project",
        name="Foreign",
        renovation_type="cosmetic",
        customer_id=foreign_customer.id,
    )
    foreign_room = Room(
        id="stage-foreign-room",
        project_id=foreign_project.id,
        name="Чужая комната",
        room_type="living",
        length_m=3,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    foreign_room_id = foreign_room.id
    db.add_all([foreign_customer, foreign_project, foreign_room])
    await db.commit()

    first = await mutations.create_stage(
        db,
        project_id=project_id,
        actor=contractor,
        name="Электромонтаж",
        planned_start=date(2026, 8, 16),
        planned_end=date(2026, 8, 20),
        room_ids=[room_id],
        work_type="electrical",
        client_request_id="stage-create-1",
    )
    assert first.replayed is False
    stage_id = first.stage.id
    assert json.loads(first.stage.room_ids_json) == [room_id]
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 2
    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.scope == mutations.STAGE_CREATE_SCOPE,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.user_id == contractor_id,
        )
    ) == 1

    replay = await mutations.create_stage(
        db,
        project_id=project_id,
        actor=contractor,
        name="Электромонтаж",
        planned_start=date(2026, 8, 16),
        planned_end=date(2026, 8, 20),
        room_ids=[room_id],
        work_type="electrical",
        client_request_id="stage-create-1",
    )
    assert replay.replayed is True
    assert replay.stage.id == stage_id
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 2

    with pytest.raises(ValueError, match="idempotency_conflict"):
        await mutations.create_stage(
            db,
            project_id=project_id,
            actor=contractor,
            name="Другой этап",
            room_ids=[room_id],
            client_request_id="stage-create-1",
        )

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    baseline_stages = await db.scalar(
        select(func.count()).select_from(Stage).where(Stage.project_id == project_id)
    )
    baseline_outbox = await db.scalar(select(func.count()).select_from(DomainOutbox))
    with pytest.raises(ValueError, match="stage_room_ids_invalid"):
        await mutations.create_stage(
            db,
            project_id=project_id,
            actor=contractor,
            name="Недопустимая комната",
            room_ids=[foreign_room_id],
            client_request_id="stage-create-foreign",
        )
    assert await db.scalar(
        select(func.count()).select_from(Stage).where(Stage.project_id == project_id)
    ) == baseline_stages
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == baseline_outbox


@pytest.mark.asyncio
async def test_stage_configuration_is_role_scoped_and_locked_after_start(db):
    customer, contractor, foreman, outsider, project, room, stage, _ = (
        await seed_stage_project(db, "config")
    )
    project_id = project.id
    stage_id = stage.id
    room_id = room.id
    customer_id = customer.id
    contractor_id = contractor.id
    foreman_id = foreman.id
    outsider_id = outsider.id

    for actor_id in (customer_id, outsider_id):
        actor = await db.get(User, actor_id)
        assert actor is not None
        with pytest.raises(ValueError, match="stage_schedule_actor_forbidden"):
            await mutations.update_work_type(
                db,
                project_id=project_id,
                stage_id=stage_id,
                actor=actor,
                work_type="painting",
            )
    assert await db.scalar(select(Stage.work_type).where(Stage.id == stage_id)) is None

    foreman = await db.get(User, foreman_id)
    assert foreman is not None
    changed = await mutations.update_work_type(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=foreman,
        work_type="painting",
    )
    assert changed is not None
    assert changed.replayed is False
    assert changed.stage.work_type == "painting"

    stored = await db.get(Stage, stage_id)
    assert stored is not None
    stored.status = StageStatus.active
    await db.commit()
    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    with pytest.raises(ValueError, match="stage_configuration_locked"):
        await mutations.update_rooms(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=contractor,
            room_ids=[room_id],
        )
    assert json.loads(
        await db.scalar(select(Stage.room_ids_json).where(Stage.id == stage_id))
    ) == [room_id]


@pytest.mark.asyncio
async def test_start_is_atomic_replay_safe_and_assignee_only(db, monkeypatch):
    customer, contractor, _, outsider, project, _, stage, predecessor = (
        await seed_stage_project(db, "start")
    )
    project_id = project.id
    stage_id = stage.id
    predecessor_id = predecessor.id
    customer_id = customer.id
    contractor_id = contractor.id
    outsider_id = outsider.id

    async def contract_ok(*_args, **_kwargs):
        return {"ok": True}

    monkeypatch.setattr(project_document_service, "project_contract_gate", contract_ok)

    customer = await db.get(User, customer_id)
    assert customer is not None
    with pytest.raises(ValueError, match="stage_execution_actor_forbidden"):
        await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=customer,
        )
    outsider = await db.get(User, outsider_id)
    assert outsider is not None
    with pytest.raises(ValueError, match="stage_execution_actor_forbidden"):
        await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=outsider,
        )

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    started, error = await mutations.start_stage(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=contractor,
    )
    assert error is None
    assert started is not None
    assert started.replayed is False
    assert started.stage.status == StageStatus.active
    assert started.stage.actual_start is not None
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 2

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    replay, replay_error = await mutations.start_stage(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=contractor,
    )
    assert replay_error is None
    assert replay is not None
    assert replay.replayed is True
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 2

    async def fail_notification(*_args, **_kwargs):
        raise RuntimeError("synthetic_stage_start_effect_failure")

    monkeypatch.setattr(mutations, "_enqueue_customer_notification", fail_notification)
    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    with pytest.raises(RuntimeError, match="synthetic_stage_start_effect_failure"):
        await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=predecessor_id,
            actor=contractor,
        )
    assert await db.scalar(
        select(Stage.status).where(Stage.id == predecessor_id)
    ) == StageStatus.planned
    assert await db.scalar(
        select(Stage.actual_start).where(Stage.id == predecessor_id)
    ) is None
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == predecessor_id)
    ) == 0


@pytest.mark.asyncio
async def test_confirmed_schedule_is_the_only_stage_date_writer(db):
    _, contractor, _, _, project, _, stage, _ = await seed_stage_project(db, "dates")
    project_id = project.id
    stage_id = stage.id
    original_start = stage.planned_start
    original_end = stage.planned_end
    schedule = ProjectWorkSchedule(
        id="confirmed-stage-schedule",
        project_id=project_id,
        status=WorkScheduleStatus.confirmed,
        title="Подтверждённый график",
        created_by=contractor.id,
        confirmed_by=project.customer_id,
        planned_start_date=date(2026, 8, 1),
        planned_finish_date=date(2026, 10, 31),
    )
    db.add(schedule)
    await db.commit()

    with pytest.raises(ValueError, match="confirmed_schedule_controls_dates"):
        await mutations.update_dates(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=contractor,
            planned_start=date(2026, 9, 1),
            planned_end=date(2026, 9, 10),
        )
    stored_start, stored_end = (
        await db.execute(
            select(Stage.planned_start, Stage.planned_end).where(Stage.id == stage_id)
        )
    ).one()
    assert (stored_start, stored_end) == (original_start, original_end)
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 0


@pytest.mark.asyncio
async def test_dependency_allows_planning_but_rejects_cycles_atomically(db):
    _, contractor, _, _, project, _, stage, predecessor = await seed_stage_project(
        db,
        "cycle",
    )
    project_id = project.id
    stage_id = stage.id
    predecessor_id = predecessor.id
    contractor_id = contractor.id

    linked = await mutations.update_dependency(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=contractor,
        depends_on_stage_id=predecessor_id,
    )
    assert linked is not None
    assert linked.stage.depends_on_stage_id == predecessor_id
    assert await db.scalar(
        select(Stage.status).where(Stage.id == predecessor_id)
    ) == StageStatus.planned

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    with pytest.raises(ValueError, match="stage_dependency_cycle"):
        await mutations.update_dependency(
            db,
            project_id=project_id,
            stage_id=predecessor_id,
            actor=contractor,
            depends_on_stage_id=stage_id,
        )
    assert await db.scalar(
        select(Stage.depends_on_stage_id).where(Stage.id == predecessor_id)
    ) is None
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == predecessor_id)
    ) == 0


@pytest.mark.asyncio
async def test_dependency_read_is_pure_and_does_not_update_status(db):
    _, _, _, _, project, _, stage, predecessor = await seed_stage_project(db, "pure")
    predecessor.status = StageStatus.done
    dependency = WorkDependency(
        id="stage-pure-dependency",
        project_id=project.id,
        stage_id=stage.id,
        depends_on_stage_id=predecessor.id,
        dependency_type="work",
        criticality="high",
        status="pending",
    )
    db.add(dependency)
    await db.commit()
    dependency_id = dependency.id

    result = await dependency_service.evaluate_stage(
        db,
        stage,
        commit=False,
        persist_status=False,
    )
    assert result["blocked"] is False
    assert await db.scalar(
        select(WorkDependency.status).where(WorkDependency.id == dependency_id)
    ) == "pending"


@pytest.mark.asyncio
async def test_ready_route_uses_canonical_completion_and_acceptance(db):
    _, contractor, _, _, project, room, stage, _ = await seed_stage_project(db, "ready")
    project_id = project.id
    stage_id = stage.id
    contractor_id = contractor.id
    room_id = room.id
    stage.status = StageStatus.active
    stage.percent_complete = 100
    stage.actual_start = date(2026, 8, 1)
    stage.checklist_json = json.dumps(
        [{"id": "finish", "title": "Завершить работы", "done": True}],
        ensure_ascii=False,
    )
    stage.room_ids_json = json.dumps([room_id])
    db.add(
        StagePhoto(
            id="stage-ready-result-photo",
            stage_id=stage_id,
            user_id=contractor_id,
            caption="Фото результата после работ",
            image_url="https://example.com/result.jpg",
        )
    )
    await db.commit()
    contractor = await db.get(User, contractor_id)
    assert contractor is not None

    response = await stage_mutations.mark_ready(
        project_id,
        stage_id,
        user=contractor,
        db=db,
    )
    assert response["status"] == StageStatus.review.value
    assert response["acceptance_status"] == "requested"
    assert response["replayed"] is False
    assert await db.scalar(
        select(func.count())
        .select_from(WorkAcceptance)
        .where(WorkAcceptance.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 3


@pytest.mark.asyncio
async def test_stage_reads_require_project_membership(db):
    _, _, _, outsider, project, _, stage, _ = await seed_stage_project(db, "read-acl")
    project_id = project.id
    stage_id = stage.id
    outsider_id = outsider.id

    outsider = await db.get(User, outsider_id)
    assert outsider is not None
    with pytest.raises(HTTPException) as detail_error:
        await stages_ext.stage_detail(project_id, stage_id, user=outsider, db=db)
    assert detail_error.value.status_code == 403

    outsider = await db.get(User, outsider_id)
    assert outsider is not None
    with pytest.raises(HTTPException) as blocked_error:
        await stages_ext.stage_blocked(project_id, stage_id, user=outsider, db=db)
    assert blocked_error.value.status_code == 403


@pytest.mark.asyncio
async def test_runtime_has_one_canonical_handler_for_each_stage_mutation():
    signatures = {
        ("/api/v1/projects/{project_id}/stages", "POST"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/start", "POST"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/ready", "POST"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/dates", "PATCH"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/rooms", "PATCH"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/work-type", "PATCH"),
        ("/api/v1/projects/{project_id}/stages/{stage_id}/depends", "PATCH"),
        ("/api/v1/projects/{project_id}/dependencies/sync", "POST"),
    }
    for path, method in signatures:
        matches = [
            route
            for route in iter_route_contexts(app.routes)
            if route.path == path
            and method in (route.methods or set())
        ]
        assert len(matches) == 1, (path, method, matches)
        assert matches[0].endpoint.__module__ == "app.api.v1.stage_mutations"
