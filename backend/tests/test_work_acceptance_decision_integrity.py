from __future__ import annotations

from datetime import date, timedelta
import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

import app.models.project_documents  # noqa: F401
from app.api.v1 import os as os_api
from app.api.v1 import work_acceptances as acceptance_api
from app.models.entities import (
    AcceptanceStatus,
    DomainOutbox,
    Payment,
    Project,
    ProjectIssue,
    Room,
    Stage,
    StageComment,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import stage_review_service
from app.services import work_acceptance_decision_service as decisions


async def seed_acceptance_stage(
    db,
    suffix: str,
    *,
    with_result_photo: bool = True,
    checklist_done: bool = True,
):
    tail = sum(
        (index + 1) * ord(character)
        for index, character in enumerate(suffix)
    ) % 10_000_000
    customer = User(id=f"acceptance-customer-{suffix}", phone=f"+7401{tail:07d}", role=UserRole.customer)
    contractor = User(id=f"acceptance-contractor-{suffix}", phone=f"+7402{tail:07d}", role=UserRole.contractor)
    outsider = User(id=f"acceptance-outsider-{suffix}", phone=f"+7403{tail:07d}", role=UserRole.customer)
    project = Project(id=f"acceptance-project-{suffix}", name="Acceptance decision integrity", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id, estimate_locked_at=None)
    room = Room(id=f"acceptance-room-{suffix}", project_id=project.id, name="Гостиная", room_type="living", length_m=4, width_m=3, height_m=2.7, openings_sq_m=2)
    stage = Stage(id=f"acceptance-stage-{suffix}", project_id=project.id, name="Чистовая отделка", sort_order=0, status=StageStatus.active, percent_complete=100 if checklist_done else 50, payment_amount=125000, weight_coefficient=0.7, assignee_id=contractor.id, actual_start=date(2026, 8, 1), room_ids_json=json.dumps([room.id]), checklist_json=json.dumps([{"id":"finish","title":"Завершить работы","done":checklist_done}], ensure_ascii=False))
    next_stage = Stage(id=f"acceptance-next-stage-{suffix}", project_id=project.id, name="Финальная уборка", sort_order=1, status=StageStatus.planned, percent_complete=0, payment_amount=25000, weight_coefficient=0.3)
    rows = [customer, contractor, outsider, project, room, stage, next_stage]
    if with_result_photo:
        rows.append(StagePhoto(id=f"acceptance-photo-{suffix}", stage_id=stage.id, user_id=contractor.id, caption="Фото результата", image_url="https://example.com/result.jpg"))
    db.add_all(rows)
    await db.commit()
    return customer, contractor, outsider, project, room, stage, next_stage


@pytest.mark.asyncio
async def test_legacy_request_uses_completion_gate_and_leaves_no_partial_state(db):
    _, contractor, _, project, _, stage, _ = await seed_acceptance_stage(db, "request-gate", with_result_photo=False)
    stage_id = stage.id
    result, error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor, comment="Готово")
    assert result is None
    assert error is not None
    assert error["code"] == "completion_gate"
    assert any(item["id"] == "photos_after" for item in error["completion"]["failed"])
    assert await db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.active
    assert await db.scalar(select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)) == 0


@pytest.mark.asyncio
async def test_request_reuses_stage_review_acceptance_without_duplicates(db):
    _, contractor, _, project, _, stage, _ = await seed_acceptance_stage(db, "request-replay")
    stage_id = stage.id
    first, error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor, comment="Все работы завершены")
    assert error is None and first is not None
    acceptance_id = first.acceptance.id
    assert first.replayed is False
    assert first.acceptance.status == AcceptanceStatus.requested.value
    assert first.acceptance.comment == "Все работы завершены"
    assert first.stage.status == StageStatus.review
    second, second_error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor, comment="Повторный запрос")
    assert second_error is None and second is not None
    assert second.replayed is True
    assert second.acceptance.id == acceptance_id
    assert second.acceptance.comment == "Все работы завершены"
    assert await db.scalar(select(func.count()).select_from(WorkAcceptance).where(WorkAcceptance.stage_id == stage_id)) == 1
    assert await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_type == "stage_review", DomainOutbox.aggregate_id == stage_id)) == 3


@pytest.mark.asyncio
async def test_accept_is_replay_safe_across_payment_document_and_next_stage(db):
    customer, contractor, _, project, _, stage, next_stage = await seed_acceptance_stage(db, "accept-replay")
    stage_id, next_stage_id = stage.id, next_stage.id
    requested, error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor)
    assert error is None and requested is not None
    acceptance_id = requested.acceptance.id
    accepted = await decisions.accept_work(db, project=project, acceptance_id=acceptance_id, actor=customer, comment="Принято", quality_score=9)
    assert accepted is not None and accepted.replayed is False
    assert accepted.acceptance.status == AcceptanceStatus.accepted.value
    assert accepted.stage.status == StageStatus.done
    assert accepted.payment_id is not None
    assert accepted.next_stage_id == next_stage_id
    counts = {
        "payments": await db.scalar(select(func.count()).select_from(Payment).where(Payment.stage_id == stage_id)),
        "documents": await db.scalar(select(func.count()).select_from(ProjectDocument).where(ProjectDocument.work_acceptance_id == acceptance_id, ProjectDocument.document_type == DocumentType.acceptance_act.value)),
        "parent_events": await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == acceptance_id, DomainOutbox.event_type == "acceptance.side_effects")),
    }
    assert counts == {"payments": 1, "documents": 1, "parent_events": 1}
    assert await db.scalar(select(Stage.status).where(Stage.id == next_stage_id)) == StageStatus.planned
    assert await db.scalar(select(Stage.actual_start).where(Stage.id == next_stage_id)) is None
    replay = await decisions.accept_work(db, project=project, acceptance_id=acceptance_id, actor=customer, comment="Повторный клик", quality_score=1)
    assert replay is not None and replay.replayed is True
    assert replay.acceptance.status == AcceptanceStatus.accepted.value
    assert replay.acceptance.comment == "Принято"
    assert replay.acceptance.quality_score == 9
    assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.stage_id == stage_id)) == counts["payments"]
    assert await db.scalar(select(func.count()).select_from(ProjectDocument).where(ProjectDocument.work_acceptance_id == acceptance_id)) == counts["documents"]
    assert await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == acceptance_id, DomainOutbox.event_type == "acceptance.side_effects")) == counts["parent_events"]


@pytest.mark.asyncio
async def test_return_rejects_stale_acceptance_and_applies_sla_issue_once(db):
    customer, contractor, _, project, room, stage, _ = await seed_acceptance_stage(db, "return-current")
    project_id, customer_id, contractor_id, room_id, stage_id = project.id, customer.id, contractor.id, room.id, stage.id
    requested, error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor)
    assert error is None and requested is not None
    stale_id = requested.acceptance.id
    current = WorkAcceptance(id="acceptance-current-return", project_id=project_id, room_id=room_id, stage_id=stage_id, requested_by=contractor_id, requested_at=requested.acceptance.requested_at + timedelta(seconds=1), status=AcceptanceStatus.requested.value, checklist_json=requested.acceptance.checklist_json)
    db.add(current); await db.commit(); current_id = current.id
    with pytest.raises(ValueError, match="acceptance_not_current"):
        await decisions.return_work(db, project=project, acceptance_id=stale_id, actor=customer, comment="Старое решение", create_issue=True)
    assert await db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.review
    assert await db.scalar(select(WorkAcceptance.status).where(WorkAcceptance.id == current_id)) == AcceptanceStatus.requested.value
    current_project, current_customer = await db.get(Project, project_id), await db.get(User, customer_id)
    assert current_project is not None and current_customer is not None
    returned = await decisions.return_work(db, project=current_project, acceptance_id=current_id, actor=current_customer, comment="Исправить примыкание", quality_score=4, create_issue=True)
    assert returned is not None and returned.replayed is False
    assert returned.acceptance.id == current_id and returned.acceptance.status == AcceptanceStatus.returned.value
    assert returned.acceptance.accepted_by == customer_id and returned.acceptance.accepted_at is not None
    assert returned.acceptance.quality_score == 4
    assert returned.stage.status == StageStatus.active and returned.stage.needs_rework is True and returned.stage.rework_deadline is not None
    assert returned.issue_id is not None
    checklist = json.loads(returned.stage.checklist_json)
    assert len([item for item in checklist if str(item.get("id", "")).startswith("rework-")]) == 1
    issue = await db.get(ProjectIssue, returned.issue_id)
    assert issue is not None and issue.stage_id == stage_id and issue.room_id == room_id and issue.assignee_id == contractor_id and issue.due_at == returned.stage.rework_deadline
    assert await db.scalar(select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage_id)) == 1
    counts = {"issues": await db.scalar(select(func.count()).select_from(ProjectIssue).where(ProjectIssue.stage_id == stage_id)), "comments": await db.scalar(select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage_id)), "outbox": await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id))}
    replay = await decisions.return_work(db, project=current_project, acceptance_id=current_id, actor=current_customer, comment="Повторный клик", quality_score=1, create_issue=True)
    assert replay is not None and replay.replayed is True
    assert replay.acceptance.comment == "Исправить примыкание" and replay.acceptance.quality_score == 4
    assert await db.scalar(select(func.count()).select_from(ProjectIssue).where(ProjectIssue.stage_id == stage_id)) == counts["issues"]
    assert await db.scalar(select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage_id)) == counts["comments"]
    assert await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == stage_id)) == counts["outbox"]


@pytest.mark.asyncio
async def test_accept_effect_failure_rolls_back_financial_and_document_cascade(db, monkeypatch):
    customer, contractor, _, project, _, stage, next_stage = await seed_acceptance_stage(db, "accept-rollback")
    project_id, customer_id, stage_id, next_stage_id = project.id, customer.id, stage.id, next_stage.id
    requested, error = await decisions.request_acceptance(db, project=project, stage_id=stage_id, actor=contractor)
    assert error is None and requested is not None
    acceptance_id = requested.acceptance.id
    async def fail_parent(*_args, **_kwargs): raise RuntimeError("synthetic_accept_parent_failure")
    monkeypatch.setattr(decisions.outbox, "enqueue", fail_parent)
    with pytest.raises(RuntimeError, match="synthetic_accept_parent_failure"):
        await decisions.accept_work(db, project=project, acceptance_id=acceptance_id, actor=customer, comment="Не должно сохраниться")
    assert await db.scalar(select(WorkAcceptance.status).where(WorkAcceptance.id == acceptance_id)) == AcceptanceStatus.requested.value
    assert await db.scalar(select(Stage.status).where(Stage.id == stage_id)) == StageStatus.review
    assert await db.scalar(select(Stage.status).where(Stage.id == next_stage_id)) == StageStatus.planned
    assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.stage_id == stage_id)) == 0
    assert await db.scalar(select(func.count()).select_from(ProjectDocument).where(ProjectDocument.work_acceptance_id == acceptance_id)) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_id == acceptance_id, DomainOutbox.event_type == "acceptance.side_effects")) == 0
    project_after, customer_after = await db.get(Project, project_id), await db.get(User, customer_id)
    assert project_after is not None and customer_after is not None


@pytest.mark.asyncio
async def test_return_effect_failure_rolls_back_sla_issue_comment_and_acceptance(db, monkeypatch):
    customer, contractor, _, project, _, stage, _ = await seed_acceptance_stage(db, "return-rollback")
    requested, error = await decisions.request_acceptance(db, project=project, stage_id=stage.id, actor=contractor)
    assert error is None and requested is not None
    acceptance_id = requested.acceptance.id
    async def fail_parent(*_args, **_kwargs): raise RuntimeError("synthetic_return_parent_failure")
    monkeypatch.setattr(decisions.outbox, "enqueue", fail_parent)
    with pytest.raises(RuntimeError, match="synthetic_return_parent_failure"):
        await decisions.return_work(db, project=project, acceptance_id=acceptance_id, actor=customer, comment="Не должно сохраниться", create_issue=True)
    assert await db.scalar(select(WorkAcceptance.status).where(WorkAcceptance.id == acceptance_id)) == AcceptanceStatus.requested.value
    assert await db.scalar(select(Stage.status).where(Stage.id == stage.id)) == StageStatus.review
    assert await db.scalar(select(func.count()).select_from(ProjectIssue).where(ProjectIssue.stage_id == stage.id)) == 0
    assert await db.scalar(select(func.count()).select_from(StageComment).where(StageComment.stage_id == stage.id)) == 0


def test_os_proxy_reuses_the_canonical_acceptance_handlers():
    assert os_api.accept_work is acceptance_api.accept_work
    assert os_api.return_work is acceptance_api.return_work


@pytest.mark.asyncio
async def test_stage_review_service_routes_to_decision_service(monkeypatch):
    accept = AsyncMock(return_value=None)
    returned = AsyncMock(return_value=None)
    monkeypatch.setattr(decisions, "accept_work", accept)
    monkeypatch.setattr(decisions, "return_work", returned)
    await stage_review_service.accept_stage(object(), object(), object(), quality_score=8, comment="ok")
    accept.assert_awaited_once()
    await stage_review_service.return_stage(object(), object(), object(), comment="fix", create_issue=True)
    returned.assert_awaited_once()
