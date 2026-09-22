"""Подписка на календарь: адрес ленты выдаётся, работает и отключается."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import User, UserRole

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "ics_feed.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    # Движок и адрес базы — глобальные: без возврата назад следующий файл тестов
    # получит ссылку на уже удалённый временный файл и упадёт на «no such table».
    previous_engine = sess.engine
    previous_session = sess.SessionLocal
    previous_url = config.settings.database_url

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()

    async with sess.SessionLocal() as db:
        db.add(User(id="ics-user", phone="+70000006001", role=UserRole.contractor))
        db.add(User(id="ics-other", phone="+70000006002", role=UserRole.contractor))
        await db.commit()

    yield

    await sess.engine.dispose()
    sess.engine = previous_engine
    sess.SessionLocal = previous_session
    config.settings.database_url = previous_url


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _token_of(url: str) -> str:
    return url.split("token=", 1)[1]


async def test_subscription_is_absent_until_asked():
    """Чтение не должно заводить доступ само."""
    async with _client() as client:
        resp = await client.get("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"active": False, "url": None}


async def test_issued_link_opens_the_feed():
    async with _client() as client:
        issued = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        assert issued.status_code == 200, issued.text
        body = issued.json()
        assert body["active"] is True
        assert "/api/v1/calendar/ics?token=" in body["url"]

        feed = await client.get("/api/v1/calendar/ics", params={"token": _token_of(body["url"])})
        assert feed.status_code == 200, feed.text
        assert feed.text.startswith("BEGIN:VCALENDAR")


async def test_repeat_keeps_the_same_link():
    """Ссылка уже могла быть подписана в чужом календаре — молча менять её нельзя."""
    async with _client() as client:
        first = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        second = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        assert first.json()["url"] == second.json()["url"]


async def test_rotate_kills_the_previous_link():
    async with _client() as client:
        first = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        old_token = _token_of(first.json()["url"])
        rotated = await client.post(
            "/api/v1/calendar/subscription",
            headers={"X-User-Id": "ics-user"},
            json={"rotate": True},
        )
        assert rotated.json()["url"] != first.json()["url"]

        dead = await client.get("/api/v1/calendar/ics", params={"token": old_token})
        assert dead.status_code == 404


async def test_revoke_turns_the_feed_off():
    async with _client() as client:
        issued = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        token = _token_of(issued.json()["url"])

        revoked = await client.delete("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        assert revoked.json() == {"ok": True, "revoked": True, "active": False, "url": None}

        dead = await client.get("/api/v1/calendar/ics", params={"token": token})
        assert dead.status_code == 404

        again = await client.delete("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        assert again.json()["revoked"] is False


async def test_tokens_are_unguessable_and_personal():
    """Ссылка — это доступ: она обязана быть длинной и у каждого своя."""
    async with _client() as client:
        mine = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-user"})
        theirs = await client.post("/api/v1/calendar/subscription", headers={"X-User-Id": "ics-other"})
        my_token = _token_of(mine.json()["url"])
        their_token = _token_of(theirs.json()["url"])
        assert my_token != their_token
        assert len(my_token) >= 32
