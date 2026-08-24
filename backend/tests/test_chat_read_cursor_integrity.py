"""P1 #269: chat read receipts are explicit, monotonic and visibility-bound."""
from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models.calendar_event  # noqa: F401 - complete metadata for create_all
import app.models.domain_outbox  # noqa: F401 - complete metadata for create_all
import app.models.work_schedule  # noqa: F401 - complete metadata for create_all
from app.api.v1.chats import ReadBody, get_chat, router
from app.db.base import Base
from app.models.entities import ChatMessage, ChatMessageType, ChatThread, ChatThreadRead
from app.services import chat_service as chat_svc

pytestmark = pytest.mark.asyncio


async def _seed_two_message_thread(db, *, thread_id: str = "thread-a", project_id: str = "project-a"):
    t0 = datetime(2026, 8, 24, 10, 0, 0)
    thread = ChatThread(
        id=thread_id,
        project_id=project_id,
        title="Read truth",
        created_by="owner",
        created_at=t0,
        updated_at=t0 + timedelta(seconds=2),
    )
    first = ChatMessage(
        id=f"{thread_id}-m1",
        thread_id=thread_id,
        user_id="sender",
        author_role="contractor",
        message_type=ChatMessageType.text,
        text="first",
        created_at=t0 + timedelta(seconds=1),
    )
    second = ChatMessage(
        id=f"{thread_id}-m2",
        thread_id=thread_id,
        user_id="sender",
        author_role="contractor",
        message_type=ChatMessageType.text,
        text="second",
        created_at=t0 + timedelta(seconds=2),
    )
    db.add_all([thread, first, second])
    await db.commit()
    return thread, first, second


async def _read_row_count(db) -> int:
    return int((await db.execute(select(func.count()).select_from(ChatThreadRead))).scalar() or 0)


async def test_read_only_chat_queries_do_not_create_read_state(db):
    await _seed_two_message_thread(db)

    assert await chat_svc.count_unread_project(db, "project-a", "viewer") == 2
    threads = await chat_svc.list_threads_enriched(db, "project-a", "viewer")

    assert threads[0]["unread_count"] == 2
    assert await _read_row_count(db) == 0


async def test_cursor_advances_only_through_target_and_is_idempotent(db):
    _thread, first, second = await _seed_two_message_thread(db)

    assert await chat_svc.mark_thread_read(db, "thread-a", "viewer", first.id) == 1
    row = await chat_svc.get_thread_read_state(db, "thread-a", "viewer")
    assert row is not None
    assert row.last_read_at == first.created_at

    assert await chat_svc.mark_thread_read(db, "thread-a", "viewer", first.id) == 1
    assert await _read_row_count(db) == 1

    assert await chat_svc.mark_thread_read(db, "thread-a", "viewer", second.id) == 0
    assert await chat_svc.mark_thread_read(db, "thread-a", "viewer", first.id) == 0
    row = await chat_svc.get_thread_read_state(db, "thread-a", "viewer")
    assert row is not None
    assert row.last_read_at == second.created_at


async def test_cross_thread_cursor_is_rejected_without_state_change(db):
    await _seed_two_message_thread(db, thread_id="thread-a", project_id="project-a")
    _other, other_first, _other_second = await _seed_two_message_thread(
        db,
        thread_id="thread-b",
        project_id="project-a",
    )

    with pytest.raises(ValueError, match="read_cursor_not_in_thread"):
        await chat_svc.mark_thread_read(db, "thread-a", "viewer", other_first.id)

    assert await _read_row_count(db) == 0


async def test_concurrent_older_cursor_cannot_regress_newer_cursor(tmp_path):
    db_path = tmp_path / "chat-read-race.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with Session() as seed:
            _thread, first, second = await _seed_two_message_thread(seed)
            first_id, second_id = first.id, second.id
            second_at = second.created_at

        async def mark(message_id: str) -> int:
            async with Session() as session:
                return await chat_svc.mark_thread_read(session, "thread-a", "viewer", message_id)

        await asyncio.gather(mark(second_id), mark(first_id))

        async with Session() as check:
            row = await chat_svc.get_thread_read_state(check, "thread-a", "viewer")
            assert row is not None
            assert row.last_read_at == second_at
            assert await chat_svc.count_unread_in_thread(check, "thread-a", "viewer") == 0
            assert await _read_row_count(check) == 1
    finally:
        await engine.dispose()


async def test_read_api_requires_cursor_and_get_is_side_effect_free_by_contract():
    assert ReadBody.model_fields["read_through_message_id"].is_required()
    source = inspect.getsource(get_chat)
    assert "mark_thread_read" not in source
    assert "_get_or_create_read" not in source

    paths = [route.path for route in router.routes]
    dynamic = "/projects/{project_id}/chats/{thread_id}"
    assert paths.index("/projects/{project_id}/chats/unread-count") < paths.index(dynamic)
    assert paths.index("/projects/{project_id}/chats/search") < paths.index(dynamic)
    assert paths.index("/projects/{project_id}/chats/{thread_id}.pdf") < paths.index(dynamic)


async def test_mobile_read_contract_is_visibility_gated_and_not_optimistic():
    root = Path(__file__).resolve().parents[2]
    chat_list = (root / "apps/mobile/components/renova/chat/ChatListView.tsx").read_text()
    chat_thread = (root / "apps/mobile/components/renova/chat/ChatThreadView.tsx").read_text()
    chat_api = (root / "apps/mobile/lib/api/chats.ts").read_text()
    inbox_store = (root / "apps/mobile/lib/inboxSyncStore.ts").read_text()

    assert "markChatReadAndSync" not in chat_list
    assert "read_through_message_id: readThroughMessageId" in chat_api
    assert "readThroughMessageId: string" in chat_api

    mark_block = inbox_store.split("export async function markChatReadAndSync", 1)[1].split(
        "export async function reloadInboxSyncAfterChatRead", 1
    )[0]
    assert "applyLocalThreadUnread" not in mark_block
    assert "await api.markChatRead(userId, projectId, threadId, readThroughMessageId)" in mark_block
    assert mark_block.index("await api.markChatRead") < mark_block.index("await reloadInboxSync")

    assert "requestAnimationFrame" in chat_thread
    assert "renderedReadCursor" in chat_thread
    assert "AppState.currentState !== 'active'" in chat_thread
    assert "overlayBlocking" in chat_thread
    ws_block = chat_thread.split("useChatWebSocket(", 1)[1].split("useChatFallbackPoll", 1)[0]
    assert "markThreadRead" not in ws_block
