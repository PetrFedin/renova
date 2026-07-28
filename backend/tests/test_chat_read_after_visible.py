"""Mark-read: cursor, monotonicity, GET does not mark."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_mark_thread_read_monotonic_and_idempotent():
    from app.services import chat_service as chat_svc

    early = datetime(2024, 1, 1, 12, 0, 0)
    late = datetime(2024, 1, 2, 12, 0, 0)
    row = MagicMock()
    row.last_read_at = late
    row.updated_at = late

    msg = MagicMock()
    msg.id = "m-old"
    msg.thread_id = "t1"
    msg.created_at = early

    db = AsyncMock()
    db.get = AsyncMock(return_value=msg)
    db.commit = AsyncMock()

    with (
        patch.object(chat_svc, "_get_or_create_read", new=AsyncMock(return_value=row)),
        patch.object(chat_svc, "count_unread_in_thread", new=AsyncMock(return_value=0)),
    ):
        result = await chat_svc.mark_thread_read(
            db, "t1", "u1", read_through_message_id="m-old",
        )
        # Не откатываем курсор
        assert row.last_read_at == late
        db.commit.assert_not_called()
        assert result["ok"] is True
        assert result["thread_unread_count"] == 0


@pytest.mark.asyncio
async def test_mark_thread_read_advances_cursor():
    from app.services import chat_service as chat_svc

    early = datetime(2024, 1, 1, 12, 0, 0)
    late = datetime(2024, 1, 2, 12, 0, 0)
    row = MagicMock()
    row.last_read_at = early
    row.updated_at = early

    msg = MagicMock()
    msg.id = "m-new"
    msg.thread_id = "t1"
    msg.created_at = late

    db = AsyncMock()
    db.get = AsyncMock(return_value=msg)
    db.commit = AsyncMock()

    with (
        patch.object(chat_svc, "_get_or_create_read", new=AsyncMock(return_value=row)),
        patch.object(chat_svc, "count_unread_in_thread", new=AsyncMock(return_value=0)),
    ):
        result = await chat_svc.mark_thread_read(
            db, "t1", "u1", read_through_message_id="m-new",
        )
        assert row.last_read_at == late
        db.commit.assert_awaited()
        assert result["read_through_message_id"] == "m-new"


@pytest.mark.asyncio
async def test_get_chat_source_has_no_mark_read():
    """Регрессия: GET chat не должен вызывать mark_thread_read."""
    import inspect
    from app.api.v1 import chats

    src = inspect.getsource(chats.get_chat)
    assert "mark_thread_read" not in src
    assert "count_unread_in_thread" in src
