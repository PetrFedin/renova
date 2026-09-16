"""P0 #316: chat-thread creation is atomic and replay-safe."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.chat_thread_creation_integrity import ChatThreadCreateIn, create_chat_thread_integrity
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatThread, ChatThreadRead, Project, User, UserRole

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008101", role=UserRole.customer, full_name="Chat customer")
    db.add(customer)
    await db.flush()
    project = Project(
        name="Chat replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(project)
    await db.commit()
    return customer, project


async def test_chat_thread_response_loss_replay_creates_one_thread_and_read_state(db):
    customer, project = await _fixture(db)
    body = ChatThreadCreateIn(
        title="Общий чат",
        topic="coordination",
        client_request_id="chat-thread-response-loss-0001",
    )

    first = await create_chat_thread_integrity(project.id, body, customer, db)
    replay = await create_chat_thread_integrity(project.id, body, customer, db)

    assert replay["id"] == first["id"]
    assert first["idempotent_replay"] is False
    assert replay["idempotent_replay"] is True

    thread_count = await db.scalar(
        select(func.count()).select_from(ChatThread).where(ChatThread.project_id == project.id)
    )
    read_count = await db.scalar(
        select(func.count()).select_from(ChatThreadRead).where(
            ChatThreadRead.thread_id == first["id"],
            ChatThreadRead.user_id == customer.id,
        )
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "chat.thread.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert thread_count == 1
    assert read_count == 1
    assert ledger_count == 1


async def test_chat_thread_same_request_id_different_payload_conflicts(db):
    customer, project = await _fixture(db)
    request_id = "chat-thread-conflict-0001"
    await create_chat_thread_integrity(
        project.id,
        ChatThreadCreateIn(title="Первый", topic="general", client_request_id=request_id),
        customer,
        db,
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_chat_thread_integrity(
            project.id,
            ChatThreadCreateIn(title="Другой", topic="general", client_request_id=request_id),
            customer,
            db,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    thread_count = await db.scalar(
        select(func.count()).select_from(ChatThread).where(ChatThread.project_id == project.id)
    )
    assert thread_count == 1
