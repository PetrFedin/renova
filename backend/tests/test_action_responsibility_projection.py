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
    def __init__(self, issues, entities):
        self.issues = issues
        self.entities = entities

    async def scalars(self, _query):
        return _ScalarRows(self.issues)

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

    result = await actions.build_action_responsibilities(db, project=_project())

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

    result = await actions.build_action_responsibilities(db, project=_project())

    assert len(result) == 1
    item = result[0]
    assert item.required_capability == "quality.review"
    assert item.responsible_persona == "owner"
    assert item.responsible_user_id == "owner"
    assert item.action == "verify_remediation"
    assert item.completion_condition == "issue.status == closed"
