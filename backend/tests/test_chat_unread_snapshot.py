"""Атомарный inbox snapshot: total согласован с тредами."""
from __future__ import annotations

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
