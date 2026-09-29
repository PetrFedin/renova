"""Issue #384: physical PostgreSQL overlap test for the task-link/reaction
shared-JSON race on ChatMessage.meta_json.

create_task_from_message backlinks the original message with
meta["linked_task_id"], and toggle_reaction mutates meta["reactions"] on the
very same ChatMessage row. Both are read-modify-write on the same JSON blob.
On SQLite (used by the fast unit suite) there is no real row-level locking, so
this race can only be demonstrated against a physical PostgreSQL instance
where a blocked UPDATE genuinely waits on another transaction's row lock.

Requires CHAT_REACTION_POSTGRES_URL (set only by the dedicated PostgreSQL
workflow); skipped otherwise, matching the convention used by
tests/test_chat_message_postgres_concurrency.py and friends.
"""
from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register canonical ORM metadata
from app.models.entities import ChatMessage, ChatThread, Project, User, UserRole
from app.services import chat_service as chat_svc


def _postgres_url() -> str:
    value = os.environ.get("CHAT_REACTION_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("CHAT_REACTION_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


@pytest.mark.asyncio
async def test_concurrent_task_link_and_reaction_both_survive_on_shared_meta():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)

    customer_id = "chat-react-race-customer-384"
    contractor_id = "chat-react-race-contractor-384"
    project_id = "chat-react-race-project-384"
    thread_id = "chat-react-race-thread-384"
    message_id = "chat-react-race-message-384"

    try:
        async with Session() as db:
            db.add_all(
                [
                    User(
                        id=customer_id,
                        phone="+79670000001",
                        role=UserRole.customer,
                        full_name="Race customer",
                    ),
                    User(
                        id=contractor_id,
                        phone="+79670000002",
                        role=UserRole.contractor,
                        full_name="Race contractor",
                    ),
                ]
            )
            await db.flush()
            db.add(
                Project(
                    id=project_id,
                    name="Chat reaction/task-link race",
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
            await db.flush()
            db.add(
                ChatMessage(
                    id=message_id,
                    thread_id=thread_id,
                    user_id=customer_id,
                    author_role="customer",
                    text="Оригинальное сообщение",
                )
            )
            await db.commit()

        async def link_task() -> None:
            async with Session() as db:
                thread = await db.get(ChatThread, thread_id)
                assert thread is not None
                await chat_svc.create_task_from_message(
                    db,
                    thread,
                    contractor_id,
                    "contractor",
                    message_id,
                    title="Задача из сообщения",
                    assignee_id=None,
                    due_at=None,
                    request_id="chat-react-race-task-0001",
                )

        async def react() -> None:
            async with Session() as db:
                await chat_svc.toggle_reaction(
                    db,
                    message_id,
                    customer_id,
                    "👍",
                    project_id=project_id,
                    client_request_id="chat-react-race-reaction-0001",
                )

        await asyncio.gather(link_task(), react())

        async with Session() as db:
            refreshed = await db.get(ChatMessage, message_id)
            meta = chat_svc._parse_meta(refreshed.meta_json)

        assert meta.get("linked_task_id"), "task-link write was clobbered by the concurrent reaction write"
        assert meta.get("reactions", {}).get("👍") == [customer_id], (
            "reaction write was clobbered by the concurrent task-link write"
        )
    finally:
        await engine.dispose()
