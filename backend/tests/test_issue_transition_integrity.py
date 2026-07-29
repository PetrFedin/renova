from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models.entities import UserRole
from app.services import issue_service as service


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
