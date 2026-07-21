"""W140: create job lead requires real customer input (not empty demo)."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "job_lead_w140.db"
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


async def test_create_lead_requires_area_and_budget():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        bad = await client.post(
            "/api/v1/job-leads",
            headers=h,
            json={"title": "Без площади"},
        )
        assert bad.status_code == 422, bad.text

        ok = await client.post(
            "/api/v1/job-leads",
            headers=h,
            json={
                "title": "Ремонт двушки",
                "area_sqm": 62,
                "renovation_type": "cosmetic",
                "budget_hint": 950000,
                "description": "Сроки гибкие",
            },
        )
        assert ok.status_code == 200, ok.text
        lead_id = ok.json()["id"]
        listed = await client.get("/api/v1/job-leads", headers=h)
        assert listed.status_code == 200
        row = next(x for x in listed.json() if x["id"] == lead_id)
        assert row["area_sqm"] == 62
        assert row["budget_hint"] == 950000
        assert row["description"] == "Сроки гибкие"
        assert row["title"] == "Ремонт двушки"
