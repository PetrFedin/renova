from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

import app.models.technical_supervision  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.api.v1 import chats as chats_api
from app.api.v1 import project_work_schedule as schedule_api
from app.api.v1 import stage_review_transitions as stage_api
from app.api.v1 import technical_supervision_chat as supervision_chat_api
from app.api.v1 import technical_supervision_schedule as supervision_schedule_api
from app.api.v1 import work_acceptances as acceptance_api
from app.models.entities import (
    ChatMessage,
    ChatThread,
    Project,
    ProjectIssue,
    Stage,
    StageComment,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.models.work_schedule import ProjectWorkSchedule, WorkScheduleStatus
from app.schemas.project_work_schedule import WorkScheduleRejectIn
from app.services import notification_service
from app.services import stage_review_service as reviews
from app.services import technical_supervision_action_service as actions
from app.services import technical_supervision_service as supervision


async def _no_dispatch(*_args, **_kwargs):
    return None


def test_chat_audit_export_preserves_supervisor_identity():
    assert chats_api._author_role_label("customer") == "Заказчик"
    assert chats_api._author_role_label("contractor") == "Исполнитель"
    assert chats_api._author_role_label("supervisor") == "Технадзор"
    assert chats_api._author_role_label("unknown") == "Система"


async def _user(db, suffix: str, *, role: UserRole, profile_code: str) -> User:
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    row = User(
        id=f"tsa-user-{suffix}",
        phone=f"+7988{tail:07d}",
        role=role,
        full_name=f"User {suffix}",
        profile_code=profile_code,
    )
    db.add(row)
    await db.flush()
    return row


async def _context(db, suffix: str = "base"):
    customer = await _user(db, f"{suffix}-owner", role=UserRole.customer, profile_code=f"O{suffix[:5].upper()}1"[:8])
    contractor = await _user(db, f"{suffix}-ctr", role=UserRole.contractor, profile_code=f"C{suffix[:5].upper()}1"[:8])
    inspector = await _user(db, f"{suffix}-sup", role=UserRole.contractor, profile_code=f"S{suffix[:5].upper()}1"[:8])
    project = Project(
        id=f"tsa-project-{suffix}",
        name=f"Project {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.commit()
    await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code=inspector.profile_code or "",
        provider_type="individual",
        provider_name="Independent inspector",
    )
    return customer, contractor, inspector, project


@pytest.mark.asyncio
async def test_supervisor_creates_project_scoped_quality_issue(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    monkeypatch.setattr(actions, "_dispatch", _no_dispatch)
    customer, contractor, inspector, project = await _context(db, "issue")
    stage = Stage(
        project_id=project.id,
        name="Штукатурка",
        sort_order=0,
        status=StageStatus.active,
        assignee_id=contractor.id,
    )
    db.add(stage)
    await db.commit()

    issue = await actions.create_quality_issue(
        db,
        project=project,
        actor=inspector,
        title="Нарушена геометрия стены",
        description="Отклонение требуется исправить до чистовой отделки.",
        stage_id=stage.id,
        severity="high",
    )
    assert issue.project_id == project.id
    assert issue.stage_id == stage.id
    assert issue.status == "open"
    assert issue.severity == "high"
    persisted = await db.get(ProjectIssue, issue.id)
    assert persisted is not None

    # Unknown/foreign stage references must fail closed instead of silently
    # creating an unscoped project issue.
    with pytest.raises(HTTPException) as error:
        await actions.create_quality_issue(
            db,
            project=project,
            actor=inspector,
            title="Неверная привязка",
            stage_id="unknown-foreign-stage",
        )
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_supervisor_returns_stage_for_rework_but_cannot_final_accept(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    monkeypatch.setattr(reviews, "_dispatch", _no_dispatch)
    customer, contractor, inspector, project = await _context(db, "rework")
    stage = Stage(
        project_id=project.id,
        name="Электрика",
        sort_order=0,
        status=StageStatus.review,
        contractor_ready=True,
        assignee_id=contractor.id,
    )
    db.add(stage)
    await db.flush()
    acceptance = WorkAcceptance(
        project_id=project.id,
        stage_id=stage.id,
        requested_by=contractor.id,
        status="requested",
    )
    db.add(acceptance)
    await db.commit()

    result = await stage_api.reject_stage(
        project_id=project.id,
        stage_id=stage.id,
        body=stage_api.StageRejectIn(text="Исправить соединение в распредкоробке"),
        user=inspector,
        db=db,
    )
    assert result["reviewer_mode"] == "supervisor"
    assert result["issue_id"] is not None
    await db.refresh(stage)
    await db.refresh(acceptance)
    assert stage.status == StageStatus.active
    assert stage.needs_rework is True
    assert acceptance.status == "returned"
    comment = (
        await db.execute(
            select(StageComment)
            .where(StageComment.stage_id == stage.id)
            .order_by(StageComment.created_at.desc())
        )
    ).scalars().first()
    assert comment is not None
    assert comment.author_role == "supervisor"

    with pytest.raises(HTTPException) as accept_error:
        await acceptance_api.accept_work(
            project_id=project.id,
            acceptance_id=acceptance.id,
            body=acceptance_api.AcceptanceDecisionIn(comment="Нельзя"),
            user=inspector,
            db=db,
        )
    assert accept_error.value.status_code == 403


@pytest.mark.asyncio
async def test_supervisor_can_reject_submitted_schedule_but_cannot_confirm_it(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    monkeypatch.setattr(actions.schedule_svc, "_dispatch_schedule_effects", _no_dispatch)
    customer, contractor, inspector, project = await _context(db, "sched")
    schedule = ProjectWorkSchedule(
        project_id=project.id,
        title="График объекта",
        created_by=contractor.id,
        submitted_by=contractor.id,
        status=WorkScheduleStatus.submitted,
    )
    db.add(schedule)
    await db.commit()

    rejected = await supervision_schedule_api.reject_project_work_schedule(
        project_id=project.id,
        schedule_id=schedule.id,
        body=WorkScheduleRejectIn(reason="Нарушена технологическая последовательность"),
        db=db,
        user=inspector,
    )
    assert rejected.status == WorkScheduleStatus.rejected
    assert rejected.rejected_by == inspector.id
    assert rejected.rejection_reason == "Нарушена технологическая последовательность"

    schedule.status = WorkScheduleStatus.submitted
    schedule.rejection_reason = None
    schedule.rejected_by = None
    schedule.rejected_at = None
    await db.commit()
    with pytest.raises(HTTPException) as confirm_error:
        await schedule_api.confirm_project_work_schedule(
            project_id=project.id,
            schedule_id=schedule.id,
            db=db,
            user=inspector,
        )
    assert confirm_error.value.status_code == 403


@pytest.mark.asyncio
async def test_supervisor_chat_is_operational_only_and_customer_messages_notify_supervisor(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer, contractor, inspector, project = await _context(db, "chat")
    thread = ChatThread(
        project_id=project.id,
        title="Рабочий чат",
        created_by=customer.id,
    )
    db.add(thread)
    await db.commit()

    sent_notifications: list[str] = []

    async def capture_notify_from_outbox(_db, *, user_id: str, **_kwargs):
        sent_notifications.append(user_id)
        return None

    async def no_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(notification_service, "notify_from_outbox", capture_notify_from_outbox)
    from app.api.v1 import ws
    monkeypatch.setattr(ws, "broadcast", no_broadcast)
    monkeypatch.setattr(ws, "broadcast_inbox", no_broadcast)

    supervisor_message = await supervision_chat_api.post_operational_message(
        project_id=project.id,
        thread_id=thread.id,
        body=chats_api.MessageCreate(
            text="Проверьте узел до закрытия",
            message_type="text",
            client_request_id="supervision-chat-0001",
        ),
        user=inspector,
        db=db,
    )
    assert supervisor_message["author_role"] == "supervisor"
    stored = await db.get(ChatMessage, supervisor_message["id"])
    assert stored is not None
    assert stored.author_role == "supervisor"

    with pytest.raises(HTTPException) as payment_error:
        await supervision_chat_api.post_operational_message(
            project_id=project.id,
            thread_id=thread.id,
            body=chats_api.MessageCreate(
                text="pay",
                message_type="payment",
                client_request_id="supervision-chat-0002",
            ),
            user=inspector,
            db=db,
        )
    assert payment_error.value.status_code == 403

    with pytest.raises(HTTPException) as invite_error:
        await chats_api.invite_to_chat(
            project_id=project.id,
            thread_id=thread.id,
            body=chats_api.InviteBody(profile_code=customer.profile_code),
            user=inspector,
            db=db,
        )
    assert invite_error.value.status_code == 403

    sent_notifications.clear()
    customer_message = await supervision_chat_api.post_operational_message(
        project_id=project.id,
        thread_id=thread.id,
        body=chats_api.MessageCreate(
            text="Заказчик добавил уточнение",
            message_type="text",
            client_request_id="supervision-chat-0003",
        ),
        user=customer,
        db=db,
    )
    assert customer_message["author_role"] == "customer"
    assert inspector.id in sent_notifications
