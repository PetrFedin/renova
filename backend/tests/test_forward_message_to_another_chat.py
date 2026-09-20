"""Пересылка сообщения в другую ветку того же объекта.

Возможности не было ни на сервере, ни в клиенте: `ChatMessage` знает про
ответ (`reply_to_id`) и ничего не знал про пересылку. При этом в переписке по
объекту это ежедневное действие — «покажи это прорабу», — и без него люди
уходят пересылать в сторонний мессенджер, унося переписку за периметр
объекта.

Пересылка сделана копией, а не ссылкой: исходное сообщение остаётся в своей
ветке, и его судьба не меняет задним числом то, что уже прочитали в другой.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import ChatMessage, ChatThread, Project, User, UserRole
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import chat_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def fw_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db):
    customer = User(id="fw-cust", phone="+79995550001", role=UserRole.customer, full_name="Заказчик")
    contractor = User(id="fw-contr", phone="+79995550002", role=UserRole.contractor, full_name="Исполнитель")
    project = Project(
        id="fw-project", name="Объект", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
    )
    other = Project(
        id="fw-other", name="Чужой объект", renovation_type="cosmetic", customer_id=customer.id,
    )
    source = ChatThread(id="fw-source", project_id=project.id, title="Общий чат объекта", created_by=customer.id)
    target = ChatThread(id="fw-target", project_id=project.id, title="Ванная", created_by=customer.id)
    alien = ChatThread(id="fw-alien", project_id=other.id, title="Чужая ветка", created_by=customer.id)
    db.add_all([customer, contractor, project, other, source, target, alien])
    await db.commit()

    message = await chat_service.send_message(
        db, source, contractor.id, "contractor", "Плитку привезли, начинаем завтра",
    )
    return source, target, alien, message, customer


async def test_copy_lands_in_the_target_thread(fw_db):
    source, target, _alien, message, customer = await seed(fw_db)
    copy = await chat_service.forward_message(
        fw_db, source=message, source_thread=source, target_thread=target,
        user_id=customer.id, role="customer",
    )
    assert copy.thread_id == target.id
    assert copy.text == "Плитку привезли, начинаем завтра"


async def test_origin_is_remembered(fw_db):
    source, target, _alien, message, customer = await seed(fw_db)
    copy = await chat_service.forward_message(
        fw_db, source=message, source_thread=source, target_thread=target,
        user_id=customer.id, role="customer",
    )
    origin = chat_service.msg_dict(copy)["forwarded_from"]
    assert origin["message_id"] == message.id
    assert origin["thread_id"] == source.id
    assert origin["thread_title"] == "Общий чат объекта"
    assert origin["author_role"] == "contractor"


async def test_original_is_untouched(fw_db):
    source, target, _alien, message, customer = await seed(fw_db)
    before = (message.text, message.thread_id, message.is_pinned)
    await chat_service.forward_message(
        fw_db, source=message, source_thread=source, target_thread=target,
        user_id=customer.id, role="customer",
    )
    await fw_db.refresh(message)
    assert (message.text, message.thread_id, message.is_pinned) == before
    assert chat_service.msg_dict(message)["forwarded_from"] is None


async def test_forward_does_not_leave_the_object(fw_db):
    # Чат привязан к объекту, и доступ проверяется по объекту. Пересылка в
    # чужой объект вынесла бы переписку туда, где её читать не разрешали.
    source, _target, alien, message, customer = await seed(fw_db)
    with pytest.raises(ValueError) as error:
        await chat_service.forward_message(
            fw_db, source=message, source_thread=source, target_thread=alien,
            user_id=customer.id, role="customer",
        )
    assert str(error.value) == "forward_cross_project_forbidden"


async def test_forward_into_the_same_thread_is_refused(fw_db):
    source, _target, _alien, message, customer = await seed(fw_db)
    with pytest.raises(ValueError) as error:
        await chat_service.forward_message(
            fw_db, source=message, source_thread=source, target_thread=source,
            user_id=customer.id, role="customer",
        )
    assert str(error.value) == "forward_same_thread"


async def test_comment_goes_above_the_quoted_text(fw_db):
    source, target, _alien, message, customer = await seed(fw_db)
    copy = await chat_service.forward_message(
        fw_db, source=message, source_thread=source, target_thread=target,
        user_id=customer.id, role="customer", comment="Смотри сроки",
    )
    assert copy.text.startswith("Смотри сроки")
    assert "Плитку привезли" in copy.text


async def test_reactions_and_pins_stay_with_the_original(fw_db):
    # Они про ту ветку и тех людей; в копии их быть не должно.
    source, target, _alien, message, customer = await seed(fw_db)
    await chat_service.toggle_reaction(fw_db, message.id, customer.id, "👍")
    message.is_pinned = True
    await fw_db.commit()

    copy = await chat_service.forward_message(
        fw_db, source=message, source_thread=source, target_thread=target,
        user_id=customer.id, role="customer",
    )
    copied = chat_service.msg_dict(copy)
    assert copied["reactions"] == {}
    assert copied["is_pinned"] is False
