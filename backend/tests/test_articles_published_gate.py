"""MKT-029/030: снятая статья не отдаётся читателям; админ читает её целиком."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "articles_gate.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    from app.db import session as sess

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


async def test_unpublished_article_is_404_publicly_but_readable_by_admin():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        admin = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h = {"X-User-Id": admin["id"]}
        body = {
            "slug": "gate-check",
            "title": "Проверка",
            "category": "process",
            "summary": "Кратко",
            "body": "Полный текст",
            "tags": "a,b",
        }
        assert (await client.post("/api/v1/articles/admin", headers=h, json=body)).status_code == 200
        assert (await client.get("/api/v1/articles/gate-check")).status_code == 200

        assert (await client.delete("/api/v1/articles/admin/gate-check", headers=h)).status_code == 200
        hidden = await client.get("/api/v1/articles/gate-check")
        assert hidden.status_code == 404, hidden.text

        full = await client.get("/api/v1/articles/admin/gate-check", headers=h)
        assert full.status_code == 200, full.text
        data = full.json()
        assert data["body"] == "Полный текст"
        assert data["tags"] == "a,b"
        assert data["published"] is False

        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        denied = await client.get("/api/v1/articles/admin/gate-check", headers={"X-User-Id": cust["id"]})
        assert denied.status_code == 403


async def test_contractor_rating_is_null_without_sources():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        con = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h = {"X-User-Id": con["id"]}
        await client.post(
            "/api/v1/contractors/profile",
            headers=h,
            json={"company_name": "ООО Тест", "specialties": "cosmetic", "city": "Москва"},
        )
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        rows = (await client.get("/api/v1/contractors", headers={"X-User-Id": cust["id"]})).json()
        assert rows
        assert all(r["rating"] is None and r["jobs_done"] is None for r in rows)
