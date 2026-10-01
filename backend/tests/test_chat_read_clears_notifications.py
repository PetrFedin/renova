"""Reading a chat must silence the notifications about it.

A new message raises two things for the recipient: the unread badge on the
chat, and a `chat_message` notification. Opening the chat cleared the first and
left the second, so the same event had to be dismissed twice, in two different
places — and the notification bell kept a number that no longer meant anything.

Measured live before the fix, on a running stand:

    before send      chats 0   notifications 24
    after send       chats 1   notifications 25
    after read       chats 0   notifications 25   ← stays

The notification carries `link_path == "/chat/{thread_id}"` and no message id,
so it can be resolved to a thread but not to a position in it. It is therefore
cleared only when the thread has no unread messages left; clearing it earlier
would silence messages the reader has not reached.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    AppNotification,
    ChatMessage,
    ChatThread,
    NotificationType,
    Project,
    User,
    UserRole,
)
from app.services import chat_service
from app.services import notification_service as notif_svc


@pytest_asyncio.fixture
async def chat_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(db, suffix: str, *, messages: int = 1):
    customer = User(id=f"cr-customer-{suffix}", phone=f"+7955{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"cr-contractor-{suffix}", phone=f"+7966{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"cr-project-{suffix}",
        name="Chat read",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id=f"cr-thread-{suffix}",
        project_id=project.id,
        title="Общий чат объекта",
        created_by=contractor.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.flush()

    sent = []
    for index in range(messages):
        message = ChatMessage(
            id=f"cr-msg-{suffix}-{index}",
            thread_id=thread.id,
            user_id=contractor.id,
            author_role=UserRole.contractor.value,
            text=f"Сообщение {index}",
        )
        db.add(message)
        sent.append(message)
    await db.commit()

    # Produced through the real producer, with the same link_path and return_to
    # chat_message_mutation passes. Hand-building the row is how the first
    # version of this test came to pass while production stayed broken: the
    # stored link is `/chat/{id}?returnTo=…`, not `/chat/{id}`, and a seed
    # written from memory had no way to know that.
    for index in range(messages):
        await notif_svc.notify(
            db,
            user_id=customer.id,
            project_id=project.id,
            notification_type="chat_message",
            title=f"Новое сообщение: {thread.title}",
            body=f"Сообщение {index}",
            link_path=f"/chat/{thread.id}",
            return_to=f"/({customer.role.value})/(tabs)/chat",
        )
    return customer, thread, sent


async def _unread_notifications(db, user_id: str) -> int:
    rows = (
        await db.execute(
            select(AppNotification).where(
                AppNotification.user_id == user_id,
                AppNotification.read.is_(False),
            )
        )
    ).scalars().all()
    return len(rows)


@pytest.mark.asyncio
async def test_reading_a_thread_clears_its_notifications(chat_db):
    customer, thread, sent = await _seed(chat_db, "basic")

    stored = (
        await chat_db.execute(
            select(AppNotification).where(AppNotification.user_id == customer.id)
        )
    ).scalars().all()
    assert len(stored) == 1
    assert stored[0].link_path.startswith(f"/chat/{thread.id}?"), (
        "the producer appends returnTo, and the clearing must cope with that; "
        f"got {stored[0].link_path}"
    )
    assert await _unread_notifications(chat_db, customer.id) == 1

    remaining = await chat_service.mark_thread_read(
        chat_db, thread.id, customer.id, sent[-1].id
    )

    assert remaining == 0
    assert await _unread_notifications(chat_db, customer.id) == 0, (
        "the chat is read, so the notification about it must not still be unread"
    )


@pytest.mark.asyncio
async def test_a_partial_read_leaves_the_notifications_alone(chat_db):
    """The notification names the thread, not the message.

    Clearing on a partial read would silence messages the reader has not
    reached — so the clearing must be tied to the thread being fully read.
    """
    customer, thread, sent = await _seed(chat_db, "partial", messages=3)

    assert await _unread_notifications(chat_db, customer.id) == 3

    remaining = await chat_service.mark_thread_read(
        chat_db, thread.id, customer.id, sent[0].id
    )

    assert remaining > 0, "two messages are still unread"
    assert await _unread_notifications(chat_db, customer.id) == 3, (
        "nothing may be cleared while the thread still has unread messages"
    )

    # …and finishing the thread clears them.
    remaining = await chat_service.mark_thread_read(
        chat_db, thread.id, customer.id, sent[-1].id
    )
    assert remaining == 0
    assert await _unread_notifications(chat_db, customer.id) == 0


@pytest.mark.asyncio
async def test_another_threads_notifications_are_untouched(chat_db):
    """Guards the guard: clearing everything would pass the first test too."""
    customer, thread, sent = await _seed(chat_db, "scoped")

    other = AppNotification(
        id="cr-notif-other",
        user_id=customer.id,
        project_id=thread.project_id,
        notification_type=NotificationType.chat_message,
        title="Новое сообщение: Другой чат",
        body="…",
        link_path="/chat/some-other-thread",
        read=False,
    )
    approval = AppNotification(
        id="cr-notif-approval",
        user_id=customer.id,
        project_id=thread.project_id,
        notification_type=NotificationType.approval,
        title="Подбор на согласование",
        body="…",
        link_path=f"/chat/{thread.id}",
        read=False,
    )
    chat_db.add_all([other, approval])
    await chat_db.commit()

    await chat_service.mark_thread_read(chat_db, thread.id, customer.id, sent[-1].id)

    chat_db.expire_all()
    stored_other = await chat_db.get(AppNotification, "cr-notif-other")
    stored_approval = await chat_db.get(AppNotification, "cr-notif-approval")

    assert stored_other.read is False, "another thread's notification must survive"
    assert stored_approval.read is False, (
        "only chat_message notifications are about reading a chat; an approval "
        "on the same link is a separate obligation"
    )


@pytest.mark.asyncio
async def test_another_users_notifications_are_untouched(chat_db):
    customer, thread, sent = await _seed(chat_db, "peruser")

    foreman = User(id="cr-foreman", phone="+79770000001", role=UserRole.contractor)
    theirs = AppNotification(
        id="cr-notif-foreman",
        user_id=foreman.id,
        project_id=thread.project_id,
        notification_type=NotificationType.chat_message,
        title="Новое сообщение: Общий чат объекта",
        body="…",
        link_path=f"/chat/{thread.id}",
        read=False,
    )
    chat_db.add_all([foreman, theirs])
    await chat_db.commit()

    await chat_service.mark_thread_read(chat_db, thread.id, customer.id, sent[-1].id)

    chat_db.expire_all()
    stored = await chat_db.get(AppNotification, "cr-notif-foreman")
    assert stored.read is False, "one reader's cursor is not another's"
