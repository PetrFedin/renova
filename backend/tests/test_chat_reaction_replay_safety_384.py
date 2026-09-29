"""Issue #384: queued chat-message reactions must be replay-safe per user intent.

The mobile offline queue (apps/mobile/lib/offlineQueue.ts) can replay a lost/
ambiguous POST .../messages/{id}/react. Before this fix,
app.services.chat_service.toggle_reaction executed every delivery as a bare
toggle: if the first request committed and the response was lost, replaying
the identical queued request flipped the already-applied reaction back off.

These tests exercise the service layer directly (same pattern as
tests/test_chat_thread_create_idempotency_390.py) and assert the bounded
contract from the issue:
  - same client_request_id + same {message_id, emoji} payload replays the
    canonical reaction state without toggling again;
  - same client_request_id with a changed payload fails closed with
    IdempotencyConflict (409 at the API layer), never silently applying the
    wrong toggle;
  - a second genuine user tap (a new client_request_id) remains a distinct
    toggle — add/remove UX is unchanged;
  - a reaction write must not clobber an unrelated field (linked_task_id)
    already present in the same ChatMessage.meta_json blob.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatMessage, ChatThread, Project, User, UserRole
from app.services import chat_service as chat_svc
from app.services.client_write_idempotency import IdempotencyConflict


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
        id="d1111111-1111-1111-1111-111111111384",
        phone="+79990000384",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="d2222222-2222-2222-2222-222222222384",
        phone="+79990000385",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="d3333333-3333-3333-3333-333333333384",
        name="Chat reaction replay safety",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="d4444444-4444-4444-4444-444444444384",
        project_id=project.id,
        title="Бригада",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.flush()
    message = ChatMessage(
        id="d5555555-5555-5555-5555-555555555384",
        thread_id=thread.id,
        user_id=contractor.id,
        author_role="contractor",
        text="Готово",
    )
    db.add(message)
    await db.commit()
    return customer, contractor, project, thread, message


@pytest.fixture
async def session_env():
    engine, Session = await _session_factory()
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_replay_of_same_intent_does_not_re_toggle(session_env):
    """Same client_request_id + same payload replayed after a lost response must
    return the canonical (already-applied) reaction state, not toggle it off."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, _thread, message = await _seed(db)

        kwargs = dict(
            message_id=message.id,
            user_id=customer.id,
            emoji="👍",
            project_id=project.id,
            client_request_id="offline-reaction-0001",
        )
        first = await chat_svc.toggle_reaction(db, **kwargs)
        assert first["👍"] == [customer.id]

        # Lost-response replay: same intent, sent again.
        second = await chat_svc.toggle_reaction(db, **kwargs)
        third = await chat_svc.toggle_reaction(db, **kwargs)

        assert second["👍"] == [customer.id]
        assert third["👍"] == [customer.id]

        refreshed = await db.get(ChatMessage, message.id)
        meta = chat_svc._parse_meta(refreshed.meta_json)
        assert meta["reactions"]["👍"] == [customer.id]

        ledger_count = (
            await db.execute(
                select(ClientWriteRequest).where(
                    ClientWriteRequest.scope == chat_svc.CHAT_MESSAGE_REACT_SCOPE,
                    ClientWriteRequest.request_id == "offline-reaction-0001",
                )
            )
        ).scalars().all()
        assert len(ledger_count) == 1


@pytest.mark.asyncio
async def test_same_request_id_different_payload_conflicts(session_env):
    """Same client_request_id reused for a different {message_id, emoji} — a
    stale/duplicate request racing a newer, distinct intent — fails closed."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, thread, message = await _seed(db)

        other_message = ChatMessage(
            id="d6666666-6666-6666-6666-666666666384",
            thread_id=thread.id,
            user_id=customer.id,
            author_role="customer",
            text="Второе сообщение",
        )
        db.add(other_message)
        await db.commit()

        await chat_svc.toggle_reaction(
            db,
            message_id=message.id,
            user_id=customer.id,
            emoji="👍",
            project_id=project.id,
            client_request_id="offline-reaction-0002",
        )

        with pytest.raises(IdempotencyConflict):
            await chat_svc.toggle_reaction(
                db,
                message_id=message.id,
                user_id=customer.id,
                emoji="🔥",  # changed emoji, same request id
                project_id=project.id,
                client_request_id="offline-reaction-0002",
            )

        with pytest.raises(IdempotencyConflict):
            await chat_svc.toggle_reaction(
                db,
                message_id=other_message.id,  # changed message, same request id
                user_id=customer.id,
                emoji="👍",
                project_id=project.id,
                client_request_id="offline-reaction-0002",
            )

        refreshed = await db.get(ChatMessage, message.id)
        meta = chat_svc._parse_meta(refreshed.meta_json)
        assert meta["reactions"]["👍"] == [customer.id]

        other_refreshed = await db.get(ChatMessage, other_message.id)
        other_meta = chat_svc._parse_meta(other_refreshed.meta_json)
        assert other_meta.get("reactions", {}) == {}


@pytest.mark.asyncio
async def test_distinct_taps_remain_distinct_toggles(session_env):
    """Two genuine user actions (different client_request_id) on the same
    message/emoji must still add then remove the reaction — current
    add/remove UX is unchanged; no server-side desired-state pre-read."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, _thread, message = await _seed(db)

        added = await chat_svc.toggle_reaction(
            db,
            message_id=message.id,
            user_id=customer.id,
            emoji="👍",
            project_id=project.id,
            client_request_id="offline-reaction-tap-0001",
        )
        assert added["👍"] == [customer.id]

        removed = await chat_svc.toggle_reaction(
            db,
            message_id=message.id,
            user_id=customer.id,
            emoji="👍",
            project_id=project.id,
            client_request_id="offline-reaction-tap-0002",
        )
        assert "👍" not in removed


@pytest.mark.asyncio
async def test_reaction_write_preserves_unrelated_metadata_fields(session_env):
    """A reaction write must not clobber other fields already present in the
    same ChatMessage.meta_json blob (e.g. the task-link backlink set by
    create_task_from_message)."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, _thread, message = await _seed(db)

        message.meta_json = chat_svc._dump_meta({"linked_task_id": "wo-existing-1"})
        await db.commit()

        await chat_svc.toggle_reaction(
            db,
            message_id=message.id,
            user_id=customer.id,
            emoji="👍",
            project_id=project.id,
            client_request_id="offline-reaction-meta-0001",
        )

        refreshed = await db.get(ChatMessage, message.id)
        meta = chat_svc._parse_meta(refreshed.meta_json)
        assert meta["linked_task_id"] == "wo-existing-1"
        assert meta["reactions"]["👍"] == [customer.id]


@pytest.mark.asyncio
async def test_toggle_without_client_request_id_keeps_plain_semantics(session_env):
    """Internal/service callers (seed data, legacy callers) without a
    client_request_id keep the pre-existing plain-toggle behavior."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, _project, _thread, message = await _seed(db)

        added = await chat_svc.toggle_reaction(db, message.id, customer.id, "👍")
        assert added["👍"] == [customer.id]

        removed = await chat_svc.toggle_reaction(db, message.id, customer.id, "👍")
        assert "👍" not in removed
