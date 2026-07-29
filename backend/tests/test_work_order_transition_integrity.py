from datetime import date
from types import SimpleNamespace

import pytest

from app.models.entities import UserRole, WorkOrderStatus
from app.services import work_order_service as service

pytestmark = pytest.mark.asyncio


def check_denied(current: str, target: str, role: UserRole, code: str):
    with pytest.raises(ValueError, match=code):
        service.validate_transition(current, target, role)


def test_role_matrix_and_payment_boundary():
    service.validate_transition("published", "approved", UserRole.customer)
    check_denied("published", "approved", UserRole.contractor, "work_order_role_forbidden")

    service.validate_transition("approved", "in_progress", UserRole.contractor)
    check_denied("approved", "in_progress", UserRole.customer, "work_order_role_forbidden")

    service.validate_transition("in_progress", "review", UserRole.contractor)
    check_denied("in_progress", "review", UserRole.customer, "work_order_role_forbidden")

    service.validate_transition("review", "done", UserRole.customer)
    check_denied("review", "done", UserRole.contractor, "only_customer_can_accept_work_order")

    service.validate_transition("review", "in_progress", UserRole.customer)
    service.validate_transition("review", "in_progress", UserRole.contractor)
    service.validate_transition("draft", "cancelled", UserRole.customer)
    service.validate_transition("draft", "cancelled", UserRole.contractor)

    check_denied("done", "paid", UserRole.customer, "payment_transition_required")
    check_denied("draft", "done", UserRole.customer, "invalid_work_order_transition")


def test_notification_targets_exclude_actor_and_deduplicate():
    project = SimpleNamespace(
        customer_id="customer",
        contractor_id="contractor",
        foreman_id="contractor",
    )
    assert service.transition_notification_targets(project, "customer") == ["contractor"]
    assert service.transition_notification_targets(project, "contractor") == ["customer"]


class FakeDb:
    async def refresh(self, _row):
        return None


async def test_transition_writes_audit_and_notifies_counterpart(monkeypatch):
    audit_events = []
    notifications = []

    async def fake_log_event(_db, **payload):
        audit_events.append(payload)

    async def fake_notify(_db, **payload):
        notifications.append(payload)

    monkeypatch.setattr(service.act, "log_event", fake_log_event)
    monkeypatch.setattr(service.notif_svc, "notify", fake_notify)

    project = SimpleNamespace(
        id="project-1",
        customer_id="customer",
        contractor_id="contractor",
        foreman_id=None,
    )
    work_order = SimpleNamespace(
        id="work-1",
        project_id="project-1",
        room_id="room-1",
        stage_id="stage-1",
        work_type="electrical",
        title="Электрика",
        status=WorkOrderStatus.approved,
        actual_start=None,
        actual_end=None,
        updated_at=None,
    )

    updated = await service.transition(
        FakeDb(),
        work_order,
        WorkOrderStatus.in_progress.value,
        "contractor",
        UserRole.contractor,
        project=project,
    )

    assert updated.status == WorkOrderStatus.in_progress
    assert updated.actual_start == date.today()
    assert len(audit_events) == 1
    assert audit_events[0]["kind"] == "work_status"
    assert "approved → in_progress" in audit_events[0]["title"]
    assert audit_events[0]["body"] == "actor_role=contractor"

    assert len(notifications) == 1
    assert notifications[0]["user_id"] == "customer"
    assert notifications[0]["notification_type"] == "stage_started"
    assert notifications[0]["link_path"] == "/work-order/work-1"
