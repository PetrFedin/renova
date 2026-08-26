from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ChatMessage,
    ChatThread,
    ChatThreadRead,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
from app.services import chat_message_mutation as mutation
from app.services import outbox_service as outbox
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
        id="11111111-1111-1111-1111-111111111111",
        phone="+79990000001",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="22222222-2222-2222-2222-222222222222",
        phone="+79990000002",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="33333333-3333-3333-3333-333333333333",
        name="Atomic chat",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="44444444-4444-4444-4444-444444444444",
        project_id=project.id,
        title="Kitchen",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.commit()
    return customer, contractor, project, thread


@pytest.fixture
async def session_env(monkeypatch):
    engine, Session = await _session_factory()

    async def _no_inline(*_args, **_kwargs):
        return 0

    async def _no_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        mutation.outbox_inline_dispatch,
        "dispatch_best_effort",
        _no_inline,
    )
    monkeypatch.setattr(mutation, "_broadcast_after_commit", _no_broadcast)
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_incoming_message_unarchives_recipient_without_advancing_read_cursor(session_env):
    _engine, Session = session_env
    async with Session() as db:
        customer, contractor, project, thread = await _seed(db)
        original_cursor = datetime(2026, 1, 5, 12, 30, 0)
        state = ChatThreadRead(
            thread_id=thread.id,
            user_id=contractor.id,
            last_read_at=original_cursor,
            is_archived=True,
        )
        sender_state = ChatThreadRead(
            thread_id=thread.id,
            user_id=customer.id,
            last_read_at=original_cursor,
            is_archived=True,
        )
        db.add_all([state, sender_state])
        await db.commit()

        message = await mutation.send_client_message(
            db,
            thread=thread,
            user_id=customer.id,
            role=customer.role.value,
            client_request_id="chat-request-0001",
            text="New work update",
        )

        recipient_state = await db.get(ChatThreadRead, state.id)
        current_sender_state = await db.get(ChatThreadRead, sender_state.id)
        assert recipient_state is not None
        assert recipient_state.is_archived is False
        assert recipient_state.last_read_at == original_cursor
        assert current_sender_state is not None
        assert current_sender_state.is_archived is True
        assert message.thread_id == thread.id

        notification_rows = (
            await db.execute(
                select(DomainOutbox).where(
                    DomainOutbox.aggregate_id == message.id,
                    DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
                )
            )
        ).scalars().all()
        assert len(notification_rows) == 1
        assert notification_rows[0].aggregate_type == "chat_message"

        ledger = (
            await db.execute(
                select(ClientWriteRequest).where(
                    ClientWriteRequest.scope == mutation.MESSAGE_CREATE_SCOPE,
                    ClientWriteRequest.project_id == project.id,
                    ClientWriteRequest.user_id == customer.id,
                    ClientWriteRequest.request_id == "chat-request-0001",
                )
            )
        ).scalar_one()
        assert ledger.entity_id == message.id


@pytest.mark.asyncio
async def test_same_request_same_payload_replays_one_message_and_one_effect_set(session_env):
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, _project, thread = await _seed(db)

        first = await mutation.send_client_message(
            db,
            thread=thread,
            user_id=customer.id,
            role=customer.role.value,
            client_request_id="chat-request-0002",
            text="Idempotent message",
            reply_to_id=None,
        )
        second = await mutation.send_client_message(
            db,
            thread=thread,
            user_id=customer.id,
            role=customer.role.value,
            client_request_id="chat-request-0002",
            text="Idempotent message",
            reply_to_id=None,
        )

        assert second.id == first.id
        message_count = (
            await db.execute(
                select(func.count()).select_from(ChatMessage).where(
                    ChatMessage.thread_id == thread.id,
                    ChatMessage.text == "Idempotent message",
                )
            )
        ).scalar_one()
        effect_count = (
            await db.execute(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_id == first.id,
                    DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
                )
            )
        ).scalar_one()
        ledger_count = (
            await db.execute(
                select(func.count()).select_from(ClientWriteRequest).where(
                    ClientWriteRequest.scope == mutation.MESSAGE_CREATE_SCOPE,
                    ClientWriteRequest.request_id == "chat-request-0002",
                )
            )
        ).scalar_one()
        assert message_count == 1
        assert effect_count == 1
        assert ledger_count == 1


@pytest.mark.asyncio
async def test_same_request_different_payload_is_conflict_without_second_message(session_env):
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, _project, thread = await _seed(db)

        first = await mutation.send_client_message(
            db,
            thread=thread,
            user_id=customer.id,
            role=customer.role.value,
            client_request_id="chat-request-0003",
            text="Original",
        )
        with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
            await mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="chat-request-0003",
                text="Changed payload",
            )

        rows = (
            await db.execute(
                select(ChatMessage).where(ChatMessage.thread_id == thread.id)
            )
        ).scalars().all()
        assert [row.id for row in rows] == [first.id]


@pytest.mark.asyncio
async def test_notification_intent_failure_rolls_back_message_archive_and_ledger(session_env, monkeypatch):
    _engine, Session = session_env
    async with Session() as db:
        customer, contractor, _project, thread = await _seed(db)
        original_cursor = datetime(2026, 2, 1, 8, 0, 0)
        state = ChatThreadRead(
            thread_id=thread.id,
            user_id=contractor.id,
            last_read_at=original_cursor,
            is_archived=True,
        )
        db.add(state)
        await db.commit()
        state_id = state.id

        async def _fail_enqueue(*_args, **_kwargs):
            raise RuntimeError("outbox_write_failed")

        monkeypatch.setattr(mutation.outbox, "enqueue_once", _fail_enqueue)
        with pytest.raises(RuntimeError, match="outbox_write_failed"):
            await mutation.send_client_message(
                db,
                thread=thread,
                user_id=customer.id,
                role=customer.role.value,
                client_request_id="chat-request-0004",
                text="Must roll back",
            )
        await db.rollback()

        restored_state = await db.get(ChatThreadRead, state_id)
        assert restored_state is not None
        assert restored_state.is_archived is True
        assert restored_state.last_read_at == original_cursor
        assert (
            await db.execute(
                select(func.count()).select_from(ChatMessage).where(
                    ChatMessage.thread_id == thread.id,
                    ChatMessage.text == "Must roll back",
                )
            )
        ).scalar_one() == 0
        assert (
            await db.execute(
                select(func.count()).select_from(ClientWriteRequest).where(
                    ClientWriteRequest.request_id == "chat-request-0004",
                )
            )
        ).scalar_one() == 0
