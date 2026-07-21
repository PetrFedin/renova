"""Атомарный inbox snapshot: total согласован с тредами."""
from __future__ import annotations

from app.api.v1 import chat_inbox
from app.api.v1.chat_inbox import UNREAD_SCOPE, _build_snapshot


def test_snapshot_excludes_archived():
    threads = [
        {"id": "a", "unread_count": 3, "is_archived": False},
        {"id": "b", "unread_count": 5, "is_archived": True},
        {"id": "c", "unread_count": 2, "is_archived": False},
    ]
    snap = _build_snapshot(threads)
    assert snap["total_unread_messages"] == 5
    assert snap["scope"] == UNREAD_SCOPE
    assert snap["scope"]["include_archived"] is False
    assert snap["scope"]["unit"] == "messages"
    assert isinstance(snap["revision"], int) and snap["revision"] > 0
    assert len(snap["threads"]) == 3


def test_snapshot_empty():
    snap = _build_snapshot([])
    assert snap["total_unread_messages"] == 0


def test_snapshot_scope_rules_documented():
    """Muted/closed N/A; unit=messages; archived excluded from total."""
    assert UNREAD_SCOPE["include_archived"] is False
    assert UNREAD_SCOPE["include_muted"] is False
    assert UNREAD_SCOPE["unit"] == "messages"


def test_zero_unread_archived_still_listed():
    threads = [{"id": "a", "unread_count": 0, "is_archived": True}]
    snap = _build_snapshot(threads)
    assert snap["total_unread_messages"] == 0
    assert len(snap["threads"]) == 1


def test_snapshot_revisions_strictly_increase_inside_same_clock_tick(monkeypatch):
    """Быстрые ответы не должны иметь одинаковый revision."""
    fixed_ns = 1_700_000_000_000_000_000
    previous = chat_inbox._last_revision
    monkeypatch.setattr(chat_inbox.time, "time_ns", lambda: fixed_ns)

    try:
        chat_inbox._last_revision = 0
        revisions = [_build_snapshot([])["revision"] for _ in range(3)]
    finally:
        chat_inbox._last_revision = previous

    fixed_us = fixed_ns // 1_000
    assert revisions == [fixed_us, fixed_us + 1, fixed_us + 2]
    assert revisions[-1] < 2**53  # безопасно для JavaScript Number


def test_snapshot_revision_never_moves_back_with_wall_clock(monkeypatch):
    """Откат wall clock не должен делать новый snapshot устаревшим."""
    values = iter([
        1_800_000_000_000_000_000,
        1_700_000_000_000_000_000,
    ])
    previous = chat_inbox._last_revision
    monkeypatch.setattr(chat_inbox.time, "time_ns", lambda: next(values))

    try:
        chat_inbox._last_revision = 0
        first = _build_snapshot([])["revision"]
        second = _build_snapshot([])["revision"]
    finally:
        chat_inbox._last_revision = previous

    assert second == first + 1
