"""Закреплённое поднимается наверх, а не проваливается вниз и не пропадает.

Две беды:

1. Список чатов сортировался по ключу ``not is_pinned`` с ``reverse=True``.
   Для закреплённого ключ равен ``False`` (0), для обычного ``True`` (1), а
   обратный порядок ставит единицу первой — закреплённые чаты уезжали в
   самый низ списка. Ровно то же в списке всех чатов пользователя.

2. Закреплённое сообщение вынималось из хронологии и переносилось в начало
   массива, то есть в самое начало истории. Переписка открывается внизу, так
   что закрепление сообщение не поднимало, а прятало — и заодно рвало ход
   разговора: реплика теряла соседей, к которым относилась.
"""
from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadRead,
    Project,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import chat_service as chat


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_threads(db) -> tuple[User, Project]:
    customer = User(id="c-pin", phone="+79990003333", role=UserRole.customer)
    contractor = User(id="k-pin", phone="+78880003333", role=UserRole.contractor)
    project = Project(
        id="p-pin",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    now = utc_now()
    db.add_all([customer, contractor, project])
    # Свежий обычный чат и более старый закреплённый: если сортировка верна,
    # закреплённый всё равно окажется выше.
    db.add(
        ChatThread(
            id="t-fresh",
            project_id=project.id,
            title="Свежий обычный",
            created_by=customer.id,
            updated_at=now,
        )
    )
    db.add(
        ChatThread(
            id="t-pinned",
            project_id=project.id,
            title="Старый закреплённый",
            created_by=customer.id,
            updated_at=now - timedelta(days=3),
        )
    )
    db.add(
        ChatThreadRead(
            thread_id="t-pinned",
            user_id=customer.id,
            is_pinned=True,
            pinned_at=now,
        )
    )
    await db.commit()
    return customer, project


@pytest.mark.asyncio
async def test_a_pinned_chat_is_first(db):
    customer, project = await seed_threads(db)

    threads = await chat.list_threads_enriched(db, project.id, customer.id)

    titles = [t["title"] for t in threads]
    assert titles[0] == "Старый закреплённый", (
        f"закреплённый чат оказался не первым: {titles}"
    )


@pytest.mark.asyncio
async def test_a_pinned_chat_is_first_in_the_inbox(db):
    customer, project = await seed_threads(db)

    inbox = await chat.list_inbox(db, customer.id, [(project.id, project.name)])

    titles = [t["title"] for t in inbox]
    assert titles[0] == "Старый закреплённый", (
        f"в общем списке чатов закреплённый оказался не первым: {titles}"
    )


@pytest.mark.asyncio
async def test_unpinned_chats_keep_their_own_order(db):
    """Среди незакреплённых порядок прежний — свежие выше."""
    customer, project = await seed_threads(db)
    now = utc_now()
    db.add(
        ChatThread(
            id="t-older",
            project_id=project.id,
            title="Ещё более старый обычный",
            created_by=customer.id,
            updated_at=now - timedelta(days=10),
        )
    )
    await db.commit()

    threads = await chat.list_threads_enriched(db, project.id, customer.id)
    titles = [t["title"] for t in threads]

    assert titles.index("Свежий обычный") < titles.index("Ещё более старый обычный")


async def seed_messages(db) -> tuple[Project, str]:
    customer = User(id="c-msg", phone="+79990004444", role=UserRole.customer)
    contractor = User(id="k-msg", phone="+78880004444", role=UserRole.contractor)
    project = Project(
        id="p-msg",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(id="t-msg", project_id=project.id, title="Общий", created_by=customer.id)
    db.add_all([customer, contractor, project, thread])
    now = utc_now()
    for index, (text, pinned) in enumerate(
        [("Первое", False), ("Важное", True), ("Последнее", False)]
    ):
        db.add(
            ChatMessage(
                id=f"m-{index}",
                thread_id=thread.id,
                user_id=customer.id,
                author_role="customer",
                message_type=ChatMessageType.text,
                text=text,
                is_pinned=pinned,
                created_at=now + timedelta(minutes=index),
            )
        )
    await db.commit()
    return project, thread.id


@pytest.mark.asyncio
async def test_a_pinned_message_keeps_its_place_in_the_conversation(db):
    """Закрепление не должно вырывать реплику из разговора."""
    from app.api.v1.chats import _msgs_with_read

    project, thread_id = await seed_messages(db)
    messages = [await db.get(ChatMessage, f"m-{i}") for i in range(3)]

    ordered = await _msgs_with_read(db, thread_id, messages)
    texts = [m["text"] for m in ordered]

    assert texts == ["Первое", "Важное", "Последнее"], (
        f"закреплённое сообщение вырвано из хронологии: {texts}"
    )


@pytest.mark.asyncio
async def test_pinned_messages_are_offered_separately(db):
    """Наверху переписки нужен отдельный список закреплённого."""
    project, thread_id = await seed_messages(db)

    pinned = await chat.pinned_messages(db, thread_id)

    assert [m["text"] for m in pinned] == ["Важное"]


@pytest.mark.asyncio
async def test_newest_pinned_message_comes_first(db):
    """Свежее закрепление важнее старого — оно и есть текущая тема."""
    project, thread_id = await seed_messages(db)
    older = await db.get(ChatMessage, "m-0")
    older.is_pinned = True
    await db.commit()

    pinned = await chat.pinned_messages(db, thread_id)

    assert [m["text"] for m in pinned] == ["Важное", "Первое"]
