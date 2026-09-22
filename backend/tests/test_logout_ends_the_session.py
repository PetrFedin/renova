"""Выход закрывает сессию на сервере и честно говорит, закрыл ли."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import User, UserRole, UserSession
from app.services import session_service as sess_svc

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "logout.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _login(client: AsyncClient) -> dict:
    """Сессия заводится напрямую: демо-вход требует посева, а проверяем мы выход."""
    async with sess.SessionLocal() as db:
        user = User(id="logout-user", phone="+70000007001", role=UserRole.customer)
        db.add(user)
        await db.commit()
        _row, raw = await sess_svc.create_session(db, user.id)
    return {"refresh_token": raw}


async def test_logout_revokes_the_session_and_says_so():
    async with _client() as client:
        tokens = await _login(client)
        refresh = tokens.get("refresh_token")
        assert refresh, tokens

        resp = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True, "revoked": True}

    async with sess.SessionLocal() as db:
        rows = (await db.execute(select(UserSession))).scalars().all()
        assert rows, "сессия должна была появиться при входе"
        assert all(row.revoked_at is not None for row in rows)


async def test_revoked_refresh_token_stops_working():
    """Смысл выхода: по старому токену новую пару уже не получить."""
    async with _client() as client:
        tokens = await _login(client)
        refresh = tokens["refresh_token"]
        await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})

        again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert again.status_code >= 400, again.text


async def test_second_logout_reports_nothing_to_revoke():
    """Повтор — не ошибка, но и не отзыв: ok остаётся, revoked становится false."""
    async with _client() as client:
        tokens = await _login(client)
        refresh = tokens["refresh_token"]
        first = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        second = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        assert first.json()["revoked"] is True
        assert second.status_code == 200
        assert second.json() == {"ok": True, "revoked": False}
