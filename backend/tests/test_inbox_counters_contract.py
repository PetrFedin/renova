"""Контракт структурированных полей GET /chats/unread-total."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_unread_total_structured_contract():
    from app.api.v1 import chat_inbox

    user = type("U", (), {"id": "u1"})()

    with (
        patch.object(chat_inbox, "_user_projects", new=AsyncMock(return_value=[("p1", "A")])),
        patch.object(chat_inbox.chat_svc, "count_unread_all", new=AsyncMock(return_value=17)),
    ):
        resp = await chat_inbox.unread_total(user=user, db=AsyncMock())
        assert resp["unread_messages"] == 17
        assert resp["count"] == 17
        assert resp["active_tasks"] == 0
        assert resp["pending_approvals"] == 0
        assert resp["payment_actions"] == 0
        assert resp["quality_actions"] == 0
        assert resp["total_action_groups"] == 1


@pytest.mark.asyncio
async def test_unread_total_zero_groups():
    from app.api.v1 import chat_inbox

    user = type("U", (), {"id": "u1"})()
    with (
        patch.object(chat_inbox, "_user_projects", new=AsyncMock(return_value=[])),
        patch.object(chat_inbox.chat_svc, "count_unread_all", new=AsyncMock(return_value=0)),
    ):
        resp = await chat_inbox.unread_total(user=user, db=AsyncMock())
        assert resp["unread_messages"] == 0
        assert resp["total_action_groups"] == 0
