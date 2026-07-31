from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.issue_transitions import IssueTransitionIn, transition_issue as transition_issue_api
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.services import issue_service as service
from app.services import outbox_inline_dispatch


def denied(current: str, target: str, role: UserRole, code: str):
    with pytest.raises(ValueError, match=code):
        service.validate_issue_transition(current, target, role)


def test_issue_role_matrix_blocks_false_close_and_self_verify():
    service.validate_issue_transition("open", "in_progress", UserRole.contractor)
    service.validate_issue_transition("open", "fixed", UserRole.contractor)
    service.validate_issue_transition("in_progress", "fixed", UserRole.contractor)
    denied("open", "closed", UserRole.customer, "invalid_issue_transition")
    denied("fixed", "closed", UserRole.contractor, "issue_transition_role_forbidden")
    denied("open", "fixed", UserRole.customer, "issue_transition_role_forbidden")

    service.validate_issue_transition("fixed", "closed", UserRole.customer)
    service.validate_issue_transition("fixed", "open", UserRole.customer)
    service.validate_issue_transition("review", "closed", UserRole.customer)
    service.validate_issue_transition("review", "open", UserRole.customer)
    service.validate_issue_transition("closed", "open", UserRole.customer)


def test_legacy_graph_is_fail_closed():
    assert service.validate_issue_status_change("open", "fixed")
    assert service.validate_issue_status_change("fixed", "closed")
    assert service.validate_issue_status_change("closed", "open")
    assert not service.validate_issue_status_change("open", "closed")
    assert not service.validate_issue_status_change("closed", "fixed")


def test_targets_and_copy_are_evidence_backed():
    project = SimpleNamespace(
        customer_id="customer",
        contractor_id="contractor",
        foreman_id="contractor",
    )
    assert service.issue_transition_targets(project, "customer") == ["contractor"]
    assert service.issue_transition_targets(project, "contractor") == ["customer"]
    assert service.issue_transition_event("fixed", "closed")[0] == "IssueClosed"
    assert service.issue_transition_event("closed", "open")[0] == "IssueReopened"
    assert service.issue_transition_notification("fixed", "open", "Стена")[1].startswith("На доработку")


class FakeDb:
    async def commit(self):
        return None

    async def refresh(self, _issue):
        return None


@pytest.mark.asyncio
async def test_close_and_reopen_manage_closed_timestamp():
    issue = SimpleNamespace(status="fixed", closed_at=None)
    closed = await service.transition_issue(FakeDb(), issue, "closed", UserRole.customer)
    assert closed.status == "closed"
    assert isinstance(closed.closed_at, datetime)
    assert closed.closed_at.tzinfo == timezone.utc

    reopened = await service.transition_issue(FakeDb(), closed, "open", UserRole.customer)
    assert reopened.status == "open"
    assert reopened.closed_at is None


@pytest_asyncio.fixture
async def issue_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_issue(db):
    customer = User(id="customer-issue", phone="+79990000501", role=UserRole.customer)
    contractor = User(id="contractor-issue", phone="+79990000502", role=UserRole.contractor)
    project = Project(
        id="project-issue",
        name="Issue atomicity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    issue = ProjectIssue(
        id="issue-atomicity",
        project_id=project.id,
        title="Трещина на стене",
        severity="medium",
        status="fixed",
    )
    db.add_all([customer, contractor, project, issue])
    await db.commit()
    return customer, contractor, project, issue


@pytest.mark.asyncio
async def test_issue_transition_commits_state_activity_and_notification_together(
    issue_db,
    monkeypatch,
):
    customer, _, project, issue = await seed_issue(issue_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    response = await transition_issue_api(
        project.id,
        issue.id,
        IssueTransitionIn(status="closed"),
        user=customer,
        db=issue_db,
    )

    assert response["status"] == "closed"
    assert response["closed_at"] is not None
    event_types = list(
        (
            await issue_db.execute(
                select(DomainOutbox.event_type).order_by(DomainOutbox.event_type)
            )
        ).scalars().all()
    )
    assert event_types == [
        "activity.created",
        "notification.created",
    ]
    assert await issue_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2
    inline_dispatch.assert_awaited_once_with(
        issue_db,
        source="issue.transition",
        limit=10,
    )


@pytest.mark.asyncio
async def test_issue_transition_rolls_back_state_when_effect_prepare_fails(
    issue_db,
    monkeypatch,
):
    customer, _, project, issue = await seed_issue(issue_db)
    project_id = project.id
    issue_id = issue.id
    monkeypatch.setattr(
        service,
        "prepare_issue_transition_effects",
        AsyncMock(side_effect=RuntimeError("issue_effect_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="issue_effect_prepare_failed"):
        await transition_issue_api(
            project_id,
            issue_id,
            IssueTransitionIn(status="closed"),
            user=customer,
            db=issue_db,
        )

    row = (
        await issue_db.execute(
            select(ProjectIssue.status, ProjectIssue.closed_at).where(
                ProjectIssue.id == issue_id
            )
        )
    ).one()
    assert row.status == "fixed"
    assert row.closed_at is None
    assert await issue_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await issue_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 0
