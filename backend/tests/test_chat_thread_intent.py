"""#390 / #316: chat-thread creation is keyed by intent, never title equality."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatMessage, ChatThread, Project, User, UserRole
from app.services import chat_thread_intent as thread_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def seed(db):
    customer = User(
        id=str(uuid.uuid4()),
        phone=f"+796{uuid.uuid4().int % 100000000:08d}",
        role=UserRole.customer,
    )
    project = Project(
        id=str(uuid.uuid4()),
        name="Thread replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([customer, project])
    await db.commit()
    return customer.id, project.id


async def count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


async def create(db, *, project_id, user_id, request_id="thread-response-loss-001", title="Общий чат", topic="general"):
    return await thread_svc.create_thread(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id=request_id,
        title=title,
        topic=topic,
    )


@pytest.mark.asyncio
async def test_response_loss_replay_returns_original_thread_and_one_system_message(db):
    user_id, project_id = await seed(db)
    first = await create(db, project_id=project_id, user_id=user_id)

    Session = async_sessionmaker(db.bind, expire_on_commit=False)
    async with Session() as fresh:
        second = await create(fresh, project_id=project_id, user_id=user_id)
        assert second.id == first.id
        assert await count(fresh, ChatThread, ChatThread.project_id == project_id) == 1
        assert await count(fresh, ChatMessage, ChatMessage.thread_id == first.id) == 1
        assert await count(
            fresh,
            ClientWriteRequest,
            ClientWriteRequest.scope == thread_svc.SCOPE,
            ClientWriteRequest.project_id == project_id,
        ) == 1


@pytest.mark.asyncio
async def test_same_request_id_with_changed_payload_conflicts_without_second_thread(db):
    user_id, project_id = await seed(db)
    first = await create(db, project_id=project_id, user_id=user_id)

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await create(
            db,
            project_id=project_id,
            user_id=user_id,
            title="Другой чат",
        )

    assert await count(db, ChatThread, ChatThread.project_id == project_id) == 1
    assert await count(db, ChatMessage, ChatMessage.thread_id == first.id) == 1


@pytest.mark.asyncio
async def test_equal_titles_with_distinct_intent_ids_are_distinct_user_actions(db):
    user_id, project_id = await seed(db)
    first = await create(
        db,
        project_id=project_id,
        user_id=user_id,
        request_id="thread-intent-first-001",
        title="Одинаковое название",
    )
    second = await create(
        db,
        project_id=project_id,
        user_id=user_id,
        request_id="thread-intent-second-001",
        title="Одинаковое название",
    )

    assert second.id != first.id
    assert await count(db, ChatThread, ChatThread.project_id == project_id) == 2
    assert await count(db, ClientWriteRequest, ClientWriteRequest.scope == thread_svc.SCOPE) == 2
    assert await count(db, ChatMessage) == 2


@pytest.mark.asyncio
async def test_precommit_failure_rolls_back_thread_system_message_and_mapping(db, monkeypatch):
    user_id, project_id = await seed(db)

    async def fail_commit(*args, **kwargs):
        await db.flush()
        raise RuntimeError("injected_precommit_failure")

    monkeypatch.setattr(thread_svc, "commit_client_write", fail_commit)
    with pytest.raises(RuntimeError, match="injected_precommit_failure"):
        await create(db, project_id=project_id, user_id=user_id)

    assert await count(db, ChatThread, ChatThread.project_id == project_id) == 0
    assert await count(db, ChatMessage) == 0
    assert await count(db, ClientWriteRequest, ClientWriteRequest.scope == thread_svc.SCOPE) == 0
