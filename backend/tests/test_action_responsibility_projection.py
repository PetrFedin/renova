from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import action_responsibility_service as actions


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _Db:
    def __init__(self, issues, entities, payments=None, acceptances=None):
        self.issues = issues
        self.entities = entities
        self.payments = payments or []
        self.acceptances = acceptances or []

    async def scalars(self, query):
        entity = query.column_descriptions[0].get("entity")
        if entity is actions.ProjectIssue:
            return _ScalarRows(self.issues)
        if entity is actions.Payment:
            return _ScalarRows(self.payments)
        if entity is actions.WorkAcceptance:
            return _ScalarRows(self.acceptances)
        raise AssertionError(f"unexpected scalar query entity: {entity}")

    async def scalar(self, _query):
        return None

    async def get(self, model, entity_id):
        return self.entities.get((model.__name__, entity_id))


def _project():
    return SimpleNamespace(id="p1", customer_id="owner", contractor_id="lead")


def _issue(status: str, *, assignee_id: str | None = None, photo_key: str | None = None):
    return SimpleNamespace(
        id=f"issue-{status}",
        project_id="p1",
        room_id=None,
        stage_id="stage-1",
        title="Проверить плитку",
        description=None,
        severity="high",
        status=status,
        assignee_id=assignee_id,
        due_at=datetime(2026, 10, 10, 12, 0, 0),
        created_at=datetime(2026, 10, 8, 12, 0, 0),
        photo_key=photo_key,
    )


@pytest.mark.asyncio
async def test_open_issue_points_to_executor_then_supervisor(monkeypatch):
    db = _Db(
        [_issue("open", assignee_id="foreman", photo_key="issues/photo.jpg")],
        {("User", "foreman"): SimpleNamespace(id="foreman", role=SimpleNamespace(value="contractor"))},
    )

    async def supervisor_id(_db, _project_id):
        return "supervisor"

    async def persona(_db, *, user, project):
        assert user.id == "foreman"
        return SimpleNamespace(persona="foreman")

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", supervisor_id)
    monkeypatch.setattr(actions.capability_svc, "resolve_operational_context", persona)

    result = await actions.build_action_responsibilities(db, project=_project(), actor=SimpleNamespace(id="owner"))

    assert len(result) == 1
    item = result[0]
    assert item.required_capability == "field.write"
    assert item.responsible_persona == "foreman"
    assert item.responsible_user_id == "foreman"
    assert item.action == "resolve_issue"
    assert item.evidence.required == ()
    assert item.evidence.present == ("issue_photo",)
    assert item.next is not None
    assert item.next.capability == "quality.review"
    assert item.next.persona == "supervisor"
    assert item.next.user_id == "supervisor"


@pytest.mark.asyncio
async def test_fixed_issue_points_to_owner_when_no_supervisor(monkeypatch):
    db = _Db([_issue("fixed")], {})

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(db, project=_project(), actor=SimpleNamespace(id="owner"))

    assert len(result) == 1
    item = result[0]
    assert item.required_capability == "quality.review"
    assert item.responsible_persona == "owner"
    assert item.responsible_user_id == "owner"
    assert item.action == "verify_remediation"
    assert item.completion_condition == "issue.status == closed"


def _payment(status):
    return SimpleNamespace(
        id=f"payment-{status.value}",
        project_id="p1",
        title="Оплата этапа",
        status=status,
        created_at=datetime(2026, 10, 8, 13, 0, 0),
    )


@pytest.mark.asyncio
async def test_pending_payment_points_to_owner_then_lead(monkeypatch):
    db = _Db([], {}, [_payment(actions.PaymentStatus.pending)])

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(db, project=_project(), actor=SimpleNamespace(id="owner"))

    assert len(result) == 1
    item = result[0]
    assert item.resource_type == "payment"
    assert item.required_capability == "payment.pay"
    assert item.responsible_persona == "owner"
    assert item.responsible_user_id == "owner"
    assert item.action == "pay_invoice"
    assert item.next is None


@pytest.mark.asyncio
async def test_paid_unverified_payment_points_to_lead_recipient(monkeypatch):
    db = _Db([], {}, [_payment(actions.PaymentStatus.paid_unverified)])

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(db, project=_project(), actor=SimpleNamespace(id="lead"))

    assert len(result) == 1
    item = result[0]
    assert item.resource_type == "payment"
    assert item.required_capability == "payment.receive.confirm"
    assert item.responsible_persona == "lead"
    assert item.responsible_user_id == "lead"
    assert item.action == "confirm_payment_received"
    assert item.evidence.present == ("transfer_marked",)
    assert item.next is None


@pytest.mark.asyncio
async def test_processing_payment_is_provider_wait_not_human_responsibility(monkeypatch):
    db = _Db([], {}, [_payment(actions.PaymentStatus.processing)])

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(db, project=_project(), actor=SimpleNamespace(id="owner"))

    assert result == []


@pytest.mark.asyncio
async def test_payment_responsibility_is_hidden_from_non_principal(monkeypatch):
    db = _Db([], {}, [_payment(actions.PaymentStatus.pending)])

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(
        db,
        project=_project(),
        actor=SimpleNamespace(id="scoped-participant"),
    )

    assert result == []


def _responsibility_item(
    *,
    action: str,
    responsible_user_id: str | None,
    due_at: str | None = None,
    required: tuple[str, ...] = (),
    present: tuple[str, ...] = (),
):
    return actions.ResponsibilityItem(
        resource_type="issue",
        resource_id="r1",
        resource_title="Тест",
        current_state="open",
        required_capability="field.write",
        responsible_persona="member",
        responsible_user_id=responsible_user_id,
        action=action,
        due_at=due_at,
        evidence=actions.ResponsibilityEvidence(required=required, present=present),
        completion_condition="done",
        next=None,
    )


def test_action_queue_bucket_priority():
    now = datetime(2026, 10, 9, 12, 0, 0)

    overdue = _responsibility_item(
        action="verify_remediation",
        responsible_user_id="owner",
        due_at="2026-10-08T12:00:00",
        required=("photo",),
        present=(),
    )
    assert actions.responsibility_bucket(overdue, actor_id="owner", now=now) == "overdue"

    evidence = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="owner",
        required=("photo",),
        present=(),
    )
    assert actions.responsibility_bucket(evidence, actor_id="owner", now=now) == "needs_evidence"

    review = _responsibility_item(action="verify_remediation", responsible_user_id="owner")
    assert actions.responsibility_bucket(review, actor_id="owner", now=now) == "waiting_review"

    owner_decision = _responsibility_item(action="decide_work_acceptance", responsible_user_id="owner")
    assert actions.responsibility_bucket(owner_decision, actor_id="owner", now=now) == "waiting_owner_decision"

    mine = _responsibility_item(action="resolve_issue", responsible_user_id="owner")
    assert actions.responsibility_bucket(mine, actor_id="owner", now=now) == "mine_now"

    other = _responsibility_item(action="resolve_issue", responsible_user_id="lead")
    assert actions.responsibility_bucket(other, actor_id="owner", now=now) == "waiting_other"


@pytest.mark.asyncio
async def test_pending_acceptance_points_to_owner_decision(monkeypatch):
    acceptance = SimpleNamespace(
        id="acc-1",
        project_id="p1",
        stage_id="stage-1",
        status="requested",
        requested_at=datetime(2026, 10, 9, 9, 0, 0),
        created_at=datetime(2026, 10, 9, 9, 0, 0),
    )
    stage = SimpleNamespace(id="stage-1", project_id="p1", name="Чистовая отделка")
    db = _Db([], {("Stage", "stage-1"): stage}, acceptances=[acceptance])

    async def no_supervisor(_db, _project_id):
        return None

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)

    result = await actions.build_action_responsibilities(
        db,
        project=_project(),
        actor=SimpleNamespace(id="owner"),
    )

    item = next(x for x in result if x.resource_type == "acceptance")
    assert item.action == "decide_work_acceptance"
    assert item.required_capability == "acceptance.decide"
    assert item.responsible_persona == "owner"
    assert item.responsible_user_id == "owner"
    assert item.resource_title == "Приёмка: Чистовая отделка"


@pytest.mark.asyncio
async def test_scoped_participant_only_sees_responsibilities_in_visible_scope(monkeypatch):
    in_scope = _issue("open", assignee_id="participant")
    in_scope.id = "issue-in"
    in_scope.stage_id = "stage-in"
    out_scope = _issue("open", assignee_id="other")
    out_scope.id = "issue-out"
    out_scope.stage_id = "stage-out"

    participant_user = SimpleNamespace(id="participant", role=SimpleNamespace(value="contractor"))
    other_user = SimpleNamespace(id="other", role=SimpleNamespace(value="contractor"))
    db = _Db(
        [in_scope, out_scope],
        {
            ("User", "participant"): participant_user,
            ("User", "other"): other_user,
        },
    )

    async def no_supervisor(_db, _project_id):
        return None

    async def active_participant(_db, *, project_id, user_id):
        assert project_id == "p1"
        assert user_id == "participant"
        return SimpleNamespace(id="pp-1", participant_role="contractor")

    async def visible_scope(_db, *, project, user_id):
        assert project.id == "p1"
        assert user_id == "participant"
        return {"stage-in"}, set()

    async def persona(_db, *, user, project):
        return SimpleNamespace(persona="participant" if user.id == "participant" else "member")

    monkeypatch.setattr(actions.supervision_actions, "active_supervisor_user_id", no_supervisor)
    monkeypatch.setattr(actions.participant_svc, "active_participant", active_participant)
    monkeypatch.setattr(actions.participant_svc, "participant_visible_scope", visible_scope)
    monkeypatch.setattr(actions.capability_svc, "resolve_operational_context", persona)

    result = await actions.build_action_responsibilities(
        db,
        project=_project(),
        actor=SimpleNamespace(id="participant"),
    )

    assert [item.resource_id for item in result] == ["issue-in"]

def test_parallel_responsibility_summary_groups_by_actor_and_preserves_priority(monkeypatch):
    items = [
        _responsibility_item(
            action="resolve_issue",
            responsible_user_id="owner",
            due_at="2026-10-08T12:00:00",
        ),
        _responsibility_item(
            action="resolve_issue",
            responsible_user_id="owner",
        ),
        actions.ResponsibilityItem(
            resource_type="issue",
            resource_id="review-1",
            resource_title="Проверка",
            current_state="fixed",
            required_capability="quality.review",
            responsible_persona="supervisor",
            responsible_user_id="supervisor",
            action="verify_remediation",
            due_at=None,
            evidence=actions.ResponsibilityEvidence(required=(), present=()),
            completion_condition="done",
            next=None,
        ),
    ]

    monkeypatch.setattr(actions, "utc_now", lambda: datetime(2026, 10, 9, 12, 0, 0))

    summary = actions.parallel_responsibility_summary(items, actor_id="owner")

    assert summary["active_actor_count"] == 2
    assert summary["active_responsibility_count"] == 3
    assert [lane["actor_key"] for lane in summary["lanes"]] == ["owner", "supervisor"]

    owner_lane = summary["lanes"][0]
    assert owner_lane["is_current_actor"] is True
    assert owner_lane["count"] == 2
    assert owner_lane["top_bucket"] == "overdue"
    assert owner_lane["bucket_counts"]["overdue"] == 1
    assert owner_lane["bucket_counts"]["mine_now"] == 1

    supervisor_lane = summary["lanes"][1]
    assert supervisor_lane["is_current_actor"] is False
    assert supervisor_lane["count"] == 1
    assert supervisor_lane["top_bucket"] == "waiting_review"


# Qualification ratchet: escalation stays a read-only projection; no reassignment, notification, or deadline mutation.
def test_escalation_signal_routes_overdue_executor_to_supervisor():
    item = actions.ResponsibilityItem(
        resource_type="issue",
        resource_id="issue-1",
        resource_title="Плитка",
        current_state="open",
        required_capability="field.write",
        responsible_persona="foreman",
        responsible_user_id="foreman",
        action="resolve_issue",
        due_at="2026-10-08T12:00:00",
        evidence=actions.ResponsibilityEvidence(required=(), present=()),
        completion_condition="issue.status == fixed",
        next=actions.ResponsibilityNext(
            capability="quality.review",
            persona="supervisor",
            user_id="supervisor",
            action="verify_remediation",
        ),
    )

    signals = actions.escalation_signals(
        [item],
        owner_user_id="owner",
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert len(signals) == 1
    signal = signals[0]
    assert signal.reason == "overdue"
    assert signal.target_persona == "supervisor"
    assert signal.target_user_id == "supervisor"
    assert signal.responsible_user_id == "foreman"


def test_escalation_signal_routes_overdue_supervisor_to_owner():
    item = actions.ResponsibilityItem(
        resource_type="issue",
        resource_id="issue-2",
        resource_title="Проверка",
        current_state="fixed",
        required_capability="quality.review",
        responsible_persona="supervisor",
        responsible_user_id="supervisor",
        action="verify_remediation",
        due_at="2026-10-08T12:00:00",
        evidence=actions.ResponsibilityEvidence(required=(), present=()),
        completion_condition="issue.status == closed",
        next=None,
    )

    signals = actions.escalation_signals(
        [item],
        owner_user_id="owner",
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert len(signals) == 1
    assert signals[0].target_persona == "owner"
    assert signals[0].target_user_id == "owner"


def test_escalation_signal_does_not_self_escalate_owner_or_future_work():
    owner_item = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="owner",
        due_at="2026-10-08T12:00:00",
    )
    future_item = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="lead",
        due_at="2026-10-10T12:00:00",
    )

    signals = actions.escalation_signals(
        [owner_item, future_item],
        owner_user_id="owner",
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert signals == []


def test_sla_routing_keeps_future_deadline_with_responsible_actor():
    item = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="lead",
        due_at="2026-10-10T12:00:00",
    )

    summary = actions.sla_routing_summary(
        [item],
        escalations=[],
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert summary["count"] == 1
    assert summary["active_count"] == 1
    assert summary["breached_count"] == 0
    route = summary["routes"][0]
    assert route["state"] == "active"
    assert route["routed_user_id"] == "lead"
    assert route["route_reason"] == "responsibility"


def test_sla_routing_uses_admitted_escalation_target_after_breach():
    item = actions.ResponsibilityItem(
        resource_type="issue",
        resource_id="issue-sla-1",
        resource_title="Плитка",
        current_state="open",
        required_capability="field.write",
        responsible_persona="foreman",
        responsible_user_id="foreman",
        action="resolve_issue",
        due_at="2026-10-08T12:00:00",
        evidence=actions.ResponsibilityEvidence(required=(), present=()),
        completion_condition="issue.status == fixed",
        next=actions.ResponsibilityNext(
            capability="quality.review",
            persona="supervisor",
            user_id="supervisor",
            action="verify_remediation",
        ),
    )
    signals = actions.escalation_signals(
        [item],
        owner_user_id="owner",
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    summary = actions.sla_routing_summary(
        [item],
        escalations=signals,
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert summary["breached_count"] == 1
    route = summary["routes"][0]
    assert route["state"] == "breached"
    assert route["routed_persona"] == "supervisor"
    assert route["routed_user_id"] == "supervisor"
    assert route["route_reason"] == "escalation"


def test_sla_routing_keeps_owner_breach_with_owner_and_skips_missing_deadline():
    owner_item = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="owner",
        due_at="2026-10-08T12:00:00",
    )
    no_deadline = _responsibility_item(
        action="resolve_issue",
        responsible_user_id="lead",
    )

    summary = actions.sla_routing_summary(
        [owner_item, no_deadline],
        escalations=[],
        now=datetime(2026, 10, 9, 12, 0, 0),
    )

    assert summary["count"] == 1
    assert summary["breached_count"] == 1
    route = summary["routes"][0]
    assert route["routed_user_id"] == "owner"
    assert route["route_reason"] == "responsibility"
