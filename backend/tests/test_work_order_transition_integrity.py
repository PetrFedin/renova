from datetime import date
from types import SimpleNamespace

import pytest

from app.models.entities import UserRole, WorkOrderStatus
from app.services import work_order_service as service


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
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, _row):
        return None


@pytest.mark.asyncio
async def test_transition_writes_audit_and_notifies_counterpart(monkeypatch):
    outbox_events = []
    dispatched = []

    async def fake_enqueue(_db, **payload):
        outbox_events.append(payload)
        return SimpleNamespace(id=f"outbox-{len(outbox_events)}")

    async def fake_dispatch(_db, *, source):
        dispatched.append(source)

    monkeypatch.setattr(service.outbox, "enqueue", fake_enqueue)
    monkeypatch.setattr(service, "_dispatch_committed_effects", fake_dispatch)

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
    db = FakeDb()

    updated = await service.transition(
        db,
        work_order,
        WorkOrderStatus.in_progress.value,
        "contractor",
        UserRole.contractor,
        project=project,
    )

    assert updated.status == WorkOrderStatus.in_progress
    assert updated.actual_start == date.today()
    assert db.commits == 1
    assert db.rollbacks == 0
    assert dispatched == ["work_order.transition"]

    assert len(outbox_events) == 2
    activity = next(event for event in outbox_events if event["event_type"] == service.outbox.ACTIVITY_EVENT)
    notification = next(event for event in outbox_events if event["event_type"] == service.outbox.NOTIFICATION_EVENT)

    assert activity["aggregate_type"] == "work_order"
    assert activity["aggregate_id"] == "work-1"
    assert activity["payload"]["kind"] == "work_status"
    assert "approved → in_progress" in activity["payload"]["title"]
    assert activity["payload"]["body"] == "actor_role=contractor"
    assert activity["payload"]["stage_id"] == "stage-1"

    assert notification["payload"]["user_id"] == "customer"
    assert notification["payload"]["notification_type"] == "stage_started"
    assert notification["payload"]["link_path"] == "/work-order/work-1"
