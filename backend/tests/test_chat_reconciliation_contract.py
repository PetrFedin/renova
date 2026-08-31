from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.entities import ChatMessage, ChatThread, DomainOutbox, Project, User, UserRole
from app.services import chat_message_mutation as mutation
from app.services import chat_service as chat_svc
from app.services import outbox_service as outbox


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(db):
    customer = User(
        id="reconcile-customer",
        phone="+79990000101",
        role=UserRole.customer,
        full_name="Reconcile customer",
    )
    contractor = User(
        id="reconcile-contractor",
        phone="+79990000102",
        role=UserRole.contractor,
        full_name="Reconcile contractor",
    )
    project = Project(
        id="reconcile-project",
        name="Chat reconciliation",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="reconcile-thread",
        project_id=project.id,
        title="Reconciliation",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.commit()
    return customer, contractor, project, thread


@pytest.mark.asyncio
async def test_replay_and_repeated_inbox_reads_do_not_double_unread_or_effects(monkeypatch):
    engine, Session = await _session_factory()

    async def _no_inline(*_args, **_kwargs):
        return 0

    async def _no_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(mutation.outbox_inline_dispatch, "dispatch_best_effort", _no_inline)
    monkeypatch.setattr(mutation, "_broadcast_after_commit", _no_broadcast)

    try:
        async with Session() as db:
            customer, contractor, project, thread = await _seed(db)
            first = await mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="reconcile-request-0001",
                text="One logical incoming message",
            )
            replay = await mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="reconcile-request-0001",
                text="One logical incoming message",
            )
            assert replay.id == first.id

            # WS delivery, fallback polling and focus reload all consume the same
            # authoritative inbox representation. Re-reading it cannot accumulate
            # unread locally or manufacture another durable notification intent.
            for _ in range(3):
                inbox = await chat_svc.list_threads_enriched(db, project.id, contractor.id)
                row = next(item for item in inbox if item["id"] == thread.id)
                assert row["unread_count"] == 1
                assert await chat_svc.count_unread_in_thread(db, thread.id, contractor.id) == 1

            assert await db.scalar(
                select(func.count()).select_from(ChatMessage).where(
                    ChatMessage.thread_id == thread.id,
                    ChatMessage.text == "One logical incoming message",
                )
            ) == 1
            assert await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_id == first.id,
                    DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
                )
            ) == 1

            # Read reconciliation is cursor-bound and idempotent. Replaying the
            # same visibility/read edge must keep unread at zero rather than
            # decrementing a client-side counter below zero.
            assert await chat_svc.mark_thread_read(
                db,
                thread.id,
                contractor.id,
                first.id,
            ) == 0
            assert await chat_svc.mark_thread_read(
                db,
                thread.id,
                contractor.id,
                first.id,
            ) == 0
            inbox_after_read = await chat_svc.list_threads_enriched(db, project.id, contractor.id)
            row_after_read = next(item for item in inbox_after_read if item["id"] == thread.id)
            assert row_after_read["unread_count"] == 0
    finally:
        await engine.dispose()


def test_mobile_ws_poll_and_read_paths_reload_authoritative_inbox_without_incrementing_unread():
    root = Path(__file__).resolve().parents[2]
    thread_source = (
        root / "apps/mobile/components/renova/chat/ChatThreadView.tsx"
    ).read_text(encoding="utf-8")
    store_source = (root / "apps/mobile/lib/inboxSyncStore.ts").read_text(encoding="utf-8")

    ws_block = thread_source.split("useChatWebSocket(threadId", 1)[1].split(
        "useChatFallbackPoll", 1
    )[0]
    assert "reload();" in ws_block
    assert "unread" not in ws_block.lower()
    assert "useChatFallbackPoll(!wsConnected && !!threadId && !!user, 15000, reload);" in thread_source

    # The store replaces unread with the server snapshot and coalesces an
    # already-running reload for the same context; it never += an event count.
    assert "chatCount = chatState.unread;" in store_source
    assert "chatCount +=" not in store_source
    assert "if (!force && reloadInflight?.key === key) return reloadInflight.promise;" in store_source

    # Duplicate read visibility edges share the same cursor-bound operation.
    assert "if (existing?.cursor === readThroughMessageId)" in store_source
    assert "await existing.promise;" in store_source
    assert "await reloadInboxSync({ userId, userRole }, true);" in store_source
