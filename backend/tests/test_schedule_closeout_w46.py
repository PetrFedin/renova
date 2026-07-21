"""W46: schedule submit/confirm + closeout checklist."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w46.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config
    from app.db import session as sess

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(
        config.settings.database_url, echo=False
    )
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(
        sess.engine, expire_on_commit=False
    )
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_schedule_submit_confirm_syncs_stage_dates():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)

        created = await client.post(
            f"/api/v1/projects/{pid}/work-schedules",
            headers=h_cont,
            json={"title": "W46 plan"},
        )
        assert created.status_code == 200, created.text
        sched = created.json()
        assert sched["items"], "expected items from stages"

        submitted = await client.post(
            f"/api/v1/projects/{pid}/work-schedules/{sched['id']}/submit",
            headers=h_cont,
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["status"] == "submitted"

        confirmed = await client.post(
            f"/api/v1/projects/{pid}/work-schedules/{sched['id']}/confirm",
            headers=h_cust,
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["status"] == "confirmed"

        # stage dates should match first item
        item = confirmed.json()["items"][0]
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = next(s for s in detail["stages"] if s["id"] == item["stage_id"])
        assert stage["planned_start"] == item["planned_start_date"]
        assert stage["planned_end"] == item["planned_finish_date"]


async def test_closeout_checklist_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        r = await client.get(f"/api/v1/projects/{pid}/closeout-checklist", headers=h_cust)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ready" in body
        assert "next_action" in body
        # demo project in progress → not ready
        assert body["ready"] is False
