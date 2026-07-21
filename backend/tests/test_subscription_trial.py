"""H1.1 / W49: Pro trial 14d once per contractor."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "sub_trial.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_start_trial_once():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h = {"X-User-Id": cont["id"]}
        me = (await client.get("/api/v1/subscription/me", headers=h)).json()
        assert me.get("trial_available") is True
        assert me.get("is_pro") is False
        started = await client.post("/api/v1/subscription/start-trial", headers=h)
        assert started.status_code == 200, started.text
        body = started.json()
        assert body.get("is_trial") is True
        assert body.get("is_pro") is True
        again = await client.post("/api/v1/subscription/start-trial", headers=h)
        assert again.status_code == 200
        assert again.json().get("code") == "already_active"


async def test_invite_link_with_role_autocreates_team():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h = {"X-User-Id": cont["id"]}
        r = await client.post("/api/v1/teams/invite-link", headers=h, json={"role": "foreman"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token")
        assert data.get("role") == "foreman"
        assert "renova://team/join/" in data.get("link", "")
