from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register canonical ORM metadata
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ChatMessage,
    ChatThread,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
from app.services import chat_message_mutation as mutation
from app.services import outbox_service as outbox


def _postgres_url() -> str:
    value = os.environ.get("CHAT_MESSAGE_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("CHAT_MESSAGE_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


async def _no_inline(*_args, **_kwargs):
    return 0


async def _no_broadcast(*_args, **_kwargs):
    return None


@pytest.mark.asyncio
async def test_concurrent_same_request_collapses_to_one_message_and_effect_set(monkeypatch):
    monkeypatch.setattr(
        mutation.outbox_inline_dispatch,
        "dispatch_best_effort",
        _no_inline,
    )
    monkeypatch.setattr(mutation, "_broadcast_after_commit", _no_broadcast)

    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id = "chat-race-customer"
    contractor_id = "chat-race-contractor"
    project_id = "chat-race-project"
    thread_id = "chat-race-thread"
    request_id = "chat-race-request-0001"
    text = "Concurrent idempotent message"

    try:
        async with Session() as db:
            customer = User(
                id=customer_id,
                phone="+79660000001",
                role=UserRole.customer,
                full_name="Chat race customer",
            )
            contractor = User(
                id=contractor_id,
                phone="+79660000002",
                role=UserRole.contractor,
                full_name="Chat race contractor",
            )
            db.add_all([customer, contractor])
            await db.flush()
            db.add(
                Project(
                    id=project_id,
                    name="Chat idempotency race",
                    renovation_type="cosmetic",
                    customer_id=customer_id,
                    contractor_id=contractor_id,
                )
            )
            await db.flush()
            db.add(
                ChatThread(
                    id=thread_id,
                    project_id=project_id,
                    title="Race thread",
                    created_by=customer_id,
                )
            )
            await db.commit()

        async def send_once() -> str:
            async with Session() as db:
                customer = await db.get(User, customer_id)
                thread = await db.get(ChatThread, thread_id)
                assert customer is not None
                assert thread is not None
                message = await mutation.send_client_message(
                    db,
                    thread=thread,
                    user_id=customer.id,
                    role=customer.role.value,
                    client_request_id=request_id,
                    text=text,
                )
                return message.id

        first_id, second_id = await asyncio.gather(send_once(), send_once())
        assert first_id == second_id

        async with Session() as db:
            message_count = await db.scalar(
                select(func.count()).select_from(ChatMessage).where(
                    ChatMessage.thread_id == thread_id,
                    ChatMessage.text == text,
                )
            )
            ledger_count = await db.scalar(
                select(func.count()).select_from(ClientWriteRequest).where(
                    ClientWriteRequest.scope == mutation.MESSAGE_CREATE_SCOPE,
                    ClientWriteRequest.project_id == project_id,
                    ClientWriteRequest.user_id == customer_id,
                    ClientWriteRequest.request_id == request_id,
                )
            )
            effect_count = await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_id == first_id,
                    DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
                )
            )

        assert message_count == 1
        assert ledger_count == 1
        assert effect_count == 1
    finally:
        await engine.dispose()
