"""Project archive / trash / restore lifecycle API."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.db import session as sess
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "project_lifecycle.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_project_archive_trash_restore():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": cust["id"]}
        listed = await client.get("/api/v1/projects", headers=headers)
        assert listed.status_code == 200
        pid = listed.json()[0]["id"]
        ar = await client.post(f"/api/v1/projects/{pid}/archive", headers=headers)
        assert ar.status_code == 200
        assert ar.json()["is_archived"] is True
        archived = await client.get("/api/v1/projects?bucket=archived", headers=headers)
        assert any(p["id"] == pid for p in archived.json())
        tr = await client.post(f"/api/v1/projects/{pid}/trash", headers=headers)
        assert tr.status_code == 200
        assert tr.json()["trashed_at"]
        rs = await client.post(f"/api/v1/projects/{pid}/restore", headers=headers)
        assert rs.status_code == 200
        assert rs.json()["trashed_at"] is None
