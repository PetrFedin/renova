"""P1.15 acceptance policy quick vs full."""
from types import SimpleNamespace

from app.services import acceptance_policy as ap


def test_quick_when_no_undone(monkeypatch):
    stage = SimpleNamespace(id="s1", name="Штукатурка", checklist_json=None, work_type=None)

    def fake_cl(_s):
        return [{"id": "1", "text": "a", "done": True}]

    monkeypatch.setattr(ap.wf, "stage_checklist", fake_cl)
    assert ap.resolve_acceptance_policy(stage) == "quick"
    assert ap.assert_accept_policy(stage, checklist=None, source="inline") == "quick"


def test_full_blocks_inline(monkeypatch):
    stage = SimpleNamespace(id="s1", name="Штукатурка", checklist_json=None, work_type=None)

    def fake_cl(_s):
        return [{"id": "1", "text": "Проверить углы", "done": False}]

    monkeypatch.setattr(ap.wf, "stage_checklist", fake_cl)
    assert ap.resolve_acceptance_policy(stage) == "full"
    try:
        ap.assert_accept_policy(stage, checklist=None, source="inline")
        assert False, "expected raise"
    except ValueError as e:
        assert str(e) == "checklist_required"


def test_full_accepts_checklist_texts(monkeypatch):
    stage = SimpleNamespace(id="s1", name="Штукатурка", checklist_json=None, work_type=None)

    def fake_cl(_s):
        return [{"id": "1", "text": "Проверить углы", "done": False}]

    monkeypatch.setattr(ap.wf, "stage_checklist", fake_cl)
    assert (
        ap.assert_accept_policy(stage, checklist=["Проверить углы"], source="api") == "full"
    )
