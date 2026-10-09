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
    def __init__(self, issues, entities, payments=None):
        self.issues = issues
        self.entities = entities
        self.payments = payments or []
        self._scalars_calls = 0

    async def scalars(self, _query):
        self._scalars_calls += 1
        return _ScalarRows(self.issues if self._scalars_calls == 1 else self.payments)

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
