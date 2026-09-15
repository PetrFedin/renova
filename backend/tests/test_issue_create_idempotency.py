"""P0 #316: QC Issue create is project-scoped, atomic and replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.issue_creation_integrity import IssueCreateIn, create_issue_integrity
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, FloorPlan, Project, ProjectIssue, Room, Stage, User, UserRole
from app.services import outbox_inline_dispatch

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990005101", role=UserRole.customer, full_name="Issue customer")
    contractor = User(phone="+79990005102", role=UserRole.contractor, full_name="Issue contractor")
    outsider = User(phone="+79990005103", role=UserRole.customer, full_name="Issue outsider")
    db.add_all([customer, contractor, outsider])
    await db.flush()

    project = Project(
        name="Issue project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    foreign = Project(
        name="Foreign issue project",
        renovation_type="cosmetic",
        customer_id=outsider.id,
    )
    db.add_all([project, foreign])
    await db.flush()

    room = Room(project_id=project.id, name="Kitchen", room_type="kitchen")
    foreign_room = Room(project_id=foreign.id, name="Foreign room", room_type="other")
    stage = Stage(project_id=project.id, name="Paint")
    foreign_stage = Stage(project_id=foreign.id, name="Foreign stage")
    plan = FloorPlan(project_id=project.id, name="Plan", image_key="plans/local.jpg")
    foreign_plan = FloorPlan(project_id=foreign.id, name="Foreign plan", image_key="plans/foreign.jpg")
    db.add_all([room, foreign_room, stage, foreign_stage, plan, foreign_plan])
    await db.commit()
    return customer, contractor, project, room, stage, plan, foreign_room, foreign_stage, foreign_plan


async def _no_dispatch(*_args, **_kwargs):
    return None


async def test_issue_response_loss_replay_creates_one_issue_and_one_effect_set(db, monkeypatch):
    customer, contractor, project, room, stage, plan, *_ = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)

    body = IssueCreateIn(
        title="Скол плитки",
        description="Заменить элемент",
        room_id=room.id,
        stage_id=stage.id,
        severity="high",
        floor_plan_id=plan.id,
        x_pct=42.5,
        y_pct=31.0,
        photo_key="photos/qc-proof.jpg",
        client_request_id="issue-response-loss-0001",
    )

    first = await create_issue_integrity(project.id, body, customer, db)
    assert first["idempotent_replay"] is False
    replay = await create_issue_integrity(project.id, body, customer, db)
    assert replay["id"] == first["id"]
    assert replay["idempotent_replay"] is True

    issue_count = await db.scalar(
        select(func.count()).select_from(ProjectIssue).where(ProjectIssue.project_id == project.id)
    )
    assert issue_count == 1

    request_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "issue.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert request_count == 1

    # One activity event + one notification to the other principal.
    outbox_count = await db.scalar(
        select(func.count()).select_from(DomainOutbox).where(
            DomainOutbox.aggregate_type == "project_issue",
            DomainOutbox.aggregate_id == first["id"],
        )
    )
    assert outbox_count == 2
    assert contractor.id != customer.id


async def test_issue_same_request_id_with_different_payload_conflicts(db, monkeypatch):
    customer, _, project, room, *_ = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    request_id = "issue-conflict-proof-0001"

    first = IssueCreateIn(
        title="Трещина",
        room_id=room.id,
        severity="medium",
        client_request_id=request_id,
    )
    await create_issue_integrity(project.id, first, customer, db)

    changed = IssueCreateIn(
        title="Другое замечание",
        room_id=room.id,
        severity="medium",
        client_request_id=request_id,
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_issue_integrity(project.id, changed, customer, db)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    issue_count = await db.scalar(
        select(func.count()).select_from(ProjectIssue).where(ProjectIssue.project_id == project.id)
    )
    assert issue_count == 1


@pytest.mark.parametrize(
    ("field", "code"),
    [
        ("room_id", "room_not_found"),
        ("stage_id", "stage_not_found"),
        ("floor_plan_id", "floor_plan_not_found"),
    ],
)
async def test_issue_rejects_cross_project_references(db, monkeypatch, field, code):
    customer, _, project, _, _, _, foreign_room, foreign_stage, foreign_plan = await _fixture(db)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", _no_dispatch)
    foreign_value = {
        "room_id": foreign_room.id,
        "stage_id": foreign_stage.id,
        "floor_plan_id": foreign_plan.id,
    }[field]
    payload = {
        "title": "Cross-project reference",
        "client_request_id": f"issue-cross-{field}-0001",
        field: foreign_value,
    }
    body = IssueCreateIn(**payload)

    with pytest.raises(HTTPException) as exc_info:
        await create_issue_integrity(project.id, body, customer, db)
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == code
