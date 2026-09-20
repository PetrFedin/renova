"""Список участников чата должен отвечать на вопрос «кто это читает».

Найдено обходом живого приложения: в чате, где заказчик переписывается с
исполнителем, «Настройки чата» → «Участники» не показывали никого. Блок в
`ChatThreadView` отрисовывается при `chat.participants.length > 0`, а
`list_participants` возвращала только строки `ChatThreadParticipant` — то есть
исключительно приглашённых. Заказчик и исполнитель попадают в чат по роли на
объекте, строк там не имеют, и список выходил пустым.

Вопрос не косметический: чат объекта читают ещё бригада исполнителя,
наблюдатели и технадзор, и заказчик об этом не знал.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ChatThread,
    ChatThreadParticipant,
    Project,
    ProjectViewer,
    Team,
    TeamMember,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import chat_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def chat_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(chat_db):
    customer = User(id="cp-customer", phone="+79990000001", role=UserRole.customer, full_name="Заказчик")
    contractor = User(id="cp-contractor", phone="+79990000002", role=UserRole.contractor, full_name="Исполнитель")
    brigade = User(id="cp-brigade", phone="+79990000003", role=UserRole.contractor, full_name="Бригадир")
    guest = User(id="cp-guest", phone="+79990000004", role=UserRole.customer, full_name="Наблюдатель")
    project = Project(
        id="cp-project",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    team = Team(id="cp-team", owner_id=contractor.id, name="Бригада")
    thread = ChatThread(
        id="cp-thread",
        project_id=project.id,
        title="Общий чат объекта",
        created_by=customer.id,
    )
    chat_db.add_all([customer, contractor, brigade, guest, project, team, thread])
    await chat_db.commit()

    chat_db.add(TeamMember(id="cp-member", team_id=team.id, user_id=brigade.id, role="foreman"))
    chat_db.add(ProjectViewer(id="cp-viewer", project_id=project.id, user_id=guest.id))
    await chat_db.commit()
    return project, thread


async def test_people_in_the_chat_are_listed(chat_db):
    _project, thread = await seed(chat_db)
    rows = await chat_service.list_participants(chat_db, thread.id)

    by_user = {row["user_id"]: row for row in rows}
    assert by_user, "список участников пуст, хотя в чате переписываются двое"
    assert by_user["cp-customer"]["role_label"] == "Заказчик"
    assert by_user["cp-contractor"]["role_label"] == "Исполнитель"


async def test_everyone_who_can_read_is_shown(chat_db):
    # Бригада и наблюдатель читают чат объекта наравне с его сторонами.
    # Заказчик должен об этом знать.
    _project, thread = await seed(chat_db)
    rows = await chat_service.list_participants(chat_db, thread.id)

    sources = {row["user_id"]: row["source"] for row in rows}
    assert sources["cp-brigade"] == "team"
    assert sources["cp-guest"] == "guest"


async def test_invited_participant_is_still_listed(chat_db):
    # Прежнее содержимое списка никуда не делось.
    _project, thread = await seed(chat_db)
    chat_db.add(
        ChatThreadParticipant(
            id="cp-invite",
            thread_id=thread.id,
            phone="+79990000009",
            invited_by="cp-customer",
            status="invited",
        )
    )
    await chat_db.commit()

    rows = await chat_service.list_participants(chat_db, thread.id)
    invited = [row for row in rows if row["source"] == "invite"]
    assert len(invited) == 1
    assert invited[0]["phone"] == "+79990000009"
    assert invited[0]["status"] == "invited"


async def test_one_person_is_one_row(chat_db):
    # Исполнителя пригласили в собственный чат: доступ у него уже есть по роли,
    # и вторая строка читалась бы как второй участник.
    _project, thread = await seed(chat_db)
    chat_db.add(
        ChatThreadParticipant(
            id="cp-dup",
            thread_id=thread.id,
            user_id="cp-contractor",
            invited_by="cp-customer",
            status="active",
        )
    )
    await chat_db.commit()

    rows = await chat_service.list_participants(chat_db, thread.id)
    contractor_rows = [row for row in rows if row["user_id"] == "cp-contractor"]
    assert len(contractor_rows) == 1
    assert contractor_rows[0]["source"] == "project"


async def test_role_access_does_not_expose_phone_numbers(chat_db):
    # Телефон — адрес приглашения, а не часть профиля для всех читающих.
    _project, thread = await seed(chat_db)
    rows = await chat_service.list_participants(chat_db, thread.id)

    for row in rows:
        if row["source"] != "invite":
            assert row["phone"] is None, f"телефон показан по роли: {row}"


async def test_keys_the_client_reads_are_intact(chat_db):
    # Экран рисует full_name || phone || profile_code и status.
    _project, thread = await seed(chat_db)
    for row in await chat_service.list_participants(chat_db, thread.id):
        assert set(row) >= {"id", "user_id", "phone", "profile_code", "full_name", "status"}


async def test_unknown_thread_does_not_invent_people(chat_db):
    assert await chat_service.list_participants(chat_db, "нет-такого-треда") == []
