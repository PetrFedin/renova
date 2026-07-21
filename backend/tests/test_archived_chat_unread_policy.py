"""Политика archive/unread — контракты сервиса."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.services.chat_service import _is_muted


def test_mute_separate_from_archive():
    now = datetime(2026, 7, 21, 12, 0, 0)
    muted = SimpleNamespace(muted_until=now + timedelta(hours=1))
    unmuted = SimpleNamespace(muted_until=now - timedelta(hours=1))
    none_m = SimpleNamespace(muted_until=None)
    assert _is_muted(muted, now=now) is True
    assert _is_muted(unmuted, now=now) is False
    assert _is_muted(none_m, now=now) is False


def test_policy_helpers_exist():
    from app.services import chat_service as svc

    assert hasattr(svc, "unarchive_recipients")
    assert callable(svc.set_thread_state)
    doc = svc.count_unread_project.__doc__ or ""
    assert "архив" in doc.lower() or "archived" in doc.lower()
