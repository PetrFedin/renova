"""Issue #390: offline chat-thread creation must be replay-safe, not title-deduped.

The mobile offline queue (apps/mobile/lib/offlineQueue.ts) can replay a lost/ambiguous
POST /projects/{project_id}/chats with the same `client_request_id`. Before this fix,
app.services.chat_service.create_thread deduplicated by normalized title
(find_thread_by_title), which meant two intentional threads with the same visible
title would collapse into one, while a genuine response-loss replay had no stable
identity to key off at all.

These tests exercise the service layer directly (same pattern as
tests/test_stage_comment_idempotency_398.py) and assert that two calls with the
same request_id + same canonical {title, topic} payload produce exactly one
ChatThread (and exactly one system message), the same request_id with a changed
title/topic is rejected as an idempotency conflict, and different request_ids with
byte-identical title/topic remain two distinct threads.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
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
        id="c1111111-1111-1111-1111-111111111111",
        phone="+79990000301",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="c2222222-2222-2222-2222-222222222222",
        phone="+79990000302",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="c3333333-3333-3333-3333-333333333333",
        name="Chat thread idempotency",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


@pytest.fixture
async def session_env():
    engine, Session = await _session_factory()
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_same_request_id_and_payload_replays_one_thread(session_env):
    """Two identical queued POST .../chats with the same client_request_id must not
    create two ChatThreads (and must not append a second system message)."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project = await _seed(db)

        kwargs = dict(
            project_id=project.id,
            user_id=customer.id,
            title="Бригада",
            topic=None,
            client_request_id="offline-chat-thread-0001",
        )
        first = await chat_svc.create_thread(db, **kwargs)
        second = await chat_svc.create_thread(db, **kwargs)

        assert second.id == first.id
        threads = (
            await db.execute(select(ChatThread).where(ChatThread.project_id == project.id))
        ).scalars().all()
        assert len(threads) == 1

        messages = (
            await db.execute(select(ChatMessage).where(ChatMessage.thread_id == first.id))
        ).scalars().all()
        assert len(messages) == 1


@pytest.mark.asyncio
async def test_same_request_id_different_payload_conflicts(session_env):
    """Same client_request_id with a changed canonical payload (title/topic) must
    raise IdempotencyConflict, never silently reuse an unrelated thread."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project = await _seed(db)
        customer_id, project_id = customer.id, project.id

        await chat_svc.create_thread(
            db,
            project_id=project_id,
            user_id=customer_id,
            title="Бригада",
            topic=None,
            client_request_id="offline-chat-thread-0002",
        )
        with pytest.raises(IdempotencyConflict):
            await chat_svc.create_thread(
                db,
                project_id=project_id,
                user_id=customer_id,
                title="Совсем другой чат",
                topic=None,
                client_request_id="offline-chat-thread-0002",
            )

        threads = (
            await db.execute(select(ChatThread).where(ChatThread.project_id == project_id))
        ).scalars().all()
        assert len(threads) == 1


@pytest.mark.asyncio
async def test_different_request_ids_identical_title_remain_distinct_threads(session_env):
    """Two independent user actions with the same visible title but different
    client_request_id values must remain two distinct ChatThreads (#390) — title
    equality is not a safe idempotency identity."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project = await _seed(db)

        first = await chat_svc.create_thread(
            db,
            project_id=project.id,
            user_id=customer.id,
            title="Бригада",
            topic=None,
            client_request_id="offline-chat-thread-0003",
        )
        second = await chat_svc.create_thread(
            db,
            project_id=project.id,
            user_id=customer.id,
            title="Бригада",
            topic=None,
            client_request_id="offline-chat-thread-0004",
        )

        assert first.id != second.id
        threads = (
            await db.execute(select(ChatThread).where(ChatThread.project_id == project.id))
        ).scalars().all()
        assert len(threads) == 2
