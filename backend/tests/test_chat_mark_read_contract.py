"""Mark-read contract: counters in response + idempotent service."""
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    Project,
    User,
    UserRole,
)
from app.services import chat_service as chat_svc


def test_mark_read_route_returns_counters_contract():
    src = Path(__file__).resolve().parents[1] / "app/api/v1/chats.py"
    text = src.read_text(encoding="utf-8")
    assert "thread_unread_count" in text
    assert "total_unread_count" in text
    assert "broadcast_inbox" in text
    assert "chat_read" in text


@pytest.mark.asyncio
async def test_mark_thread_read_idempotent(db: AsyncSession):
    customer = User(id="u-c", phone="+7001", role=UserRole.customer, full_name="C")
    contractor = User(id="u-k", phone="+7002", role=UserRole.contractor, full_name="K")
    project = Project(
        id="p1",
        name="Obj",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="t1",
        project_id=project.id,
        title="Chat",
        created_by=contractor.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.flush()
    msg = ChatMessage(
        id="m1",
        thread_id=thread.id,
        user_id=contractor.id,
        author_role="contractor",
        message_type=ChatMessageType.text,
        text="hi",
        created_at=utc_now(),
    )
    db.add(msg)
    await db.commit()

    before = await chat_svc.count_unread_in_thread(db, thread.id, customer.id)
    assert before >= 1

    await chat_svc.mark_thread_read(db, thread.id, customer.id)
    assert await chat_svc.count_unread_in_thread(db, thread.id, customer.id) == 0

    await chat_svc.mark_thread_read(db, thread.id, customer.id)
    assert await chat_svc.count_unread_in_thread(db, thread.id, customer.id) == 0

    st = await chat_svc._get_or_create_read(db, thread.id, customer.id)
    st.is_archived = True
    await db.commit()
    assert await chat_svc.count_unread_project(db, project.id, customer.id) == 0
