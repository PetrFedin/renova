from __future__ import annotations

from datetime import date
import json

import pytest
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select

from app.main import app
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    Project,
    Room,
    Stage,
    StageComment,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import stage_review_service as reviews


async def seed_stage(
    db,
    suffix: str,
    *,
    with_result_photo: bool = True,
    status: StageStatus = StageStatus.active,
):
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    customer = User(
        id=f"stage-review-customer-{suffix}",
        phone=f"+7501{tail:07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"stage-review-contractor-{suffix}",
        phone=f"+7502{tail:07d}",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"stage-review-outsider-{suffix}",
        phone=f"+7503{tail:07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"stage-review-project-{suffix}",
        name="Stage review integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"stage-review-room-{suffix}",
        project_id=project.id,
        name="Гостиная",
        room_type="living",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    stage = Stage(
        id=f"stage-review-stage-{suffix}",
        project_id=project.id,
        name="Чистовая отделка",
        sort_order=0,
        status=status,
        percent_complete=100,
        payment_amount=100000,
        weight_coefficient=1,
        assignee_id=contractor.id,
        actual_start=date(2026, 8, 1),
        checklist_json=json.dumps(
            [{"id": "finish", "title": "Завершить работы", "done": True}],
            ensure_ascii=False,
        ),
        room_ids_json=json.dumps([room.id]),
    )
    rows = [customer, contractor, outsider, project, room, stage]
    if with_result_photo:
        rows.append(
            StagePhoto(
                id=f"stage-review-photo-{suffix}",
                stage_id=stage.id,
                user_id=contractor.id,
                caption="Фото после завершения",
                image_url="https://example.com/result.jpg",
            )
        )
    db.add_all(rows)
    await db.commit()
    return customer, contractor, outsider, project, room, stage


@pytest.mark.asyncio
async def test_submit_creates_one_acceptance_and_durable_evidence(db):
    _, contractor, _, project, room, stage = await seed_stage(db, "submit")
    project_id = project.id
    stage_id = stage.id

    result, error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert error is None
    assert result is not None
    assert result.replayed is False
    assert result.stage.status == StageStatus.review
    assert result.stage.contractor_ready is True
    assert result.stage.contractor_ready_at is not None
    assert result.stage.actual_end is not None
    acceptance_id = result.acceptance.id
    assert result.acceptance.status == "requested"
    assert result.acceptance.project_id == project_id
    assert result.acceptance.stage_id == stage_id
    assert result.acceptance.room_id == room.id
    assert result.acceptance.requested_by == contractor.id

    assert await db.scalar(
        select(func.count())
        .select_from(WorkAcceptance)
        .where(WorkAcceptance.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "stage_review",
            DomainOutbox.aggregate_id == stage_id,
        )
    ) == 3
    assert await db.scalar(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.project_id == project_id,
            ActivityEvent.kind.in_(("WorkCompleted", "InspectionRequested")),
        )
    ) == 2

    replay, replay_error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert replay_error is None
    assert replay is not None
    assert replay.replayed is True
    assert replay.acceptance.id == acceptance_id
    assert await db.scalar(
        select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 3


@pytest.mark.asyncio
async def test_completion_gate_leaves_stage_and_acceptance_untouched(db):
    _, contractor, _, project, _, stage = await seed_stage(
        db,
        "gate",
        with_result_photo=False,
    )
    stage_id = stage.id

    result, error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert result is None
    assert error is not None
    assert error["code"] == "completion_gate"
    assert any(
        item["id"] == "photos_after"
        for item in error["completion"]["failed"]
    )
    status, ready = (
        await db.execute(
            select(Stage.status, Stage.contractor_ready).where(Stage.id == stage_id)
        )
    ).one()
    assert status == StageStatus.active
    assert ready is False
    assert await db.scalar(
        select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)
    ) == 0
    assert await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    ) == 0


@pytest.mark.asyncio
async def test_submit_requires_assignee_and_stage_project_scope(db):
    _, contractor, outsider, project_a, _, stage = await seed_stage(db, "scope-a")
    _, _, _, project_b, _, _ = await seed_stage(db, "scope-b")
    stage_id = stage.id
    project_a_id = project_a.id
    project_b_id = project_b.id
    outsider_id = outsider.id

    result, error = await reviews.submit_for_review(
        db,
        project=project_b,
        stage_id=stage_id,
        actor=contractor,
    )
    assert result is None
    assert error is None

    project_a = await db.get(Project, project_a_id)
    outsider = await db.get(User, outsider_id)
    with pytest.raises(ValueError, match="stage_submit_actor_forbidden"):
        await reviews.submit_for_review(
            db,
            project=project_a,
            stage_id=stage_id,
            actor=outsider,
        )
    assert await db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.active
    assert project_b_id != project_a_id


@pytest.mark.asyncio
async def test_reject_returns_acceptance_adds_sla_task_and_is_replay_safe(db):
    customer, contractor, _, project, _, stage = await seed_stage(db, "reject")
    project_id = project.id
    stage_id = stage.id
    contractor_id = contractor.id

    submitted, error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert error is None
    assert submitted is not None
    acceptance_id = submitted.acceptance.id

    rejected = await reviews.reject_for_rework(
        db,
        project=project,
        stage_id=stage_id,
        actor=customer,
        reason="Исправить примыкание плинтуса",
    )
    assert rejected is not None
    assert rejected.replayed is False
    assert rejected.stage.status == StageStatus.active
    assert rejected.stage.contractor_ready is False
    assert rejected.stage.contractor_ready_at is None
    assert rejected.stage.actual_end is None
    assert rejected.stage.needs_rework is True
    assert rejected.stage.rework_deadline is not None
    assert rejected.acceptance.id == acceptance_id
    assert rejected.acceptance.status == "returned"
    assert rejected.acceptance.comment == "Исправить примыкание плинтуса"

    checklist = json.loads(rejected.stage.checklist_json)
    rework_items = [item for item in checklist if str(item.get("id", "")).startswith("rework-")]
    assert len(rework_items) == 1
    assert rework_items[0]["done"] is False
    assert "примыкание" in rework_items[0]["title"].lower()
    assert await db.scalar(
        select(func.count())
        .select_from(StageComment)
        .where(StageComment.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == stage_id)
    ) == 5

    replay = await reviews.reject_for_rework(
        db,
        project=project,
        stage_id=stage_id,
        actor=customer,
        reason="Повторная отправка",
    )
    assert replay is not None
    assert replay.replayed is True
    replay_checklist = json.loads(replay.stage.checklist_json)
    assert len([item for item in replay_checklist if str(item.get("id", "")).startswith("rework-")]) == 1
    assert await db.scalar(
        select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    ) == 5

    blocked, gate_error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert blocked is None
    assert gate_error is not None
    assert any(
        item["id"] == "checklist"
        for item in gate_error["completion"]["failed"]
    )

    project = await db.get(Project, project_id)
    contractor = await db.get(User, contractor_id)
    stored = await db.get(Stage, stage_id)
    checklist = json.loads(stored.checklist_json)
    for item in checklist:
        item["done"] = True
    stored.checklist_json = json.dumps(checklist, ensure_ascii=False)
    await db.commit()

    resubmitted, resubmit_error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert resubmit_error is None
    assert resubmitted is not None
    assert resubmitted.replayed is False
    assert resubmitted.stage.status == StageStatus.review
    assert resubmitted.stage.needs_rework is False
    assert resubmitted.acceptance.id == acceptance_id
    assert resubmitted.acceptance.status == "requested"
    assert await db.scalar(
        select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)
    ) == 1
    assert await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    ) == 8


@pytest.mark.asyncio
async def test_reject_requires_project_owner(db):
    _, contractor, outsider, project, _, stage = await seed_stage(db, "reject-acl")
    stage_id = stage.id
    project_id = project.id
    outsider_id = outsider.id
    submitted, error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert error is None
    assert submitted is not None

    project = await db.get(Project, project_id)
    outsider = await db.get(User, outsider_id)
    with pytest.raises(ValueError, match="stage_reject_actor_forbidden"):
        await reviews.reject_for_rework(
            db,
            project=project,
            stage_id=stage_id,
            actor=outsider,
            reason="Нет полномочий",
        )
    assert await db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.review


@pytest.mark.asyncio
async def test_submit_effect_failure_rolls_back_stage_acceptance_and_outbox(db, monkeypatch):
    _, contractor, _, project, _, stage = await seed_stage(db, "submit-rollback")
    stage_id = stage.id

    async def fail_activity(*_args, **_kwargs):
        raise RuntimeError("synthetic_submit_effect_failure")

    monkeypatch.setattr(reviews, "_enqueue_activity", fail_activity)
    with pytest.raises(RuntimeError, match="synthetic_submit_effect_failure"):
        await reviews.submit_for_review(
            db,
            project=project,
            stage_id=stage_id,
            actor=contractor,
        )

    status, ready, actual_end = (
        await db.execute(
            select(Stage.status, Stage.contractor_ready, Stage.actual_end).where(Stage.id == stage_id)
        )
    ).one()
    assert status == StageStatus.active
    assert ready is False
    assert actual_end is None
    assert await db.scalar(
        select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)
    ) == 0
    assert await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    ) == 0


@pytest.mark.asyncio
async def test_reject_effect_failure_rolls_back_every_rework_change(db, monkeypatch):
    customer, contractor, _, project, _, stage = await seed_stage(db, "reject-rollback")
    stage_id = stage.id
    submitted, error = await reviews.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=contractor,
    )
    assert error is None
    assert submitted is not None
    acceptance_id = submitted.acceptance.id
    baseline_outbox = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    )

    async def fail_notification(*_args, **_kwargs):
        raise RuntimeError("synthetic_reject_effect_failure")

    monkeypatch.setattr(reviews, "_enqueue_notification", fail_notification)
    with pytest.raises(RuntimeError, match="synthetic_reject_effect_failure"):
        await reviews.reject_for_rework(
            db,
            project=project,
            stage_id=stage_id,
            actor=customer,
            reason="Не должно сохраниться",
        )

    status, ready, needs_rework, deadline = (
        await db.execute(
            select(
                Stage.status,
                Stage.contractor_ready,
                Stage.needs_rework,
                Stage.rework_deadline,
            ).where(Stage.id == stage_id)
        )
    ).one()
    assert status == StageStatus.review
    assert ready is True
    assert needs_rework is False
    assert deadline is None
    assert await db.scalar(
        select(WorkAcceptance.status).where(WorkAcceptance.id == acceptance_id)
    ) == "requested"
    assert await db.scalar(
        select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage_id)
    ) == 0
    assert await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)
    ) == baseline_outbox
    checklist_json = await db.scalar(select(Stage.checklist_json).where(Stage.id == stage_id))
    checklist = json.loads(checklist_json)
    assert not any(str(item.get("id", "")).startswith("rework-") for item in checklist)


def test_runtime_has_one_canonical_submit_and_reject_handler():
    counts: dict[str, int] = {}
    expected = {
        "/api/v1/projects/{project_id}/stages/{stage_id}/submit",
        "/api/v1/projects/{project_id}/stages/{stage_id}/reject",
    }
    for route in iter_route_contexts(app.routes):
        path = getattr(route, "path", "")
        methods = set(getattr(route, "methods", set()) or set())
        if path in expected and "POST" in methods:
            counts[path] = counts.get(path, 0) + 1
    assert counts == {path: 1 for path in expected}
