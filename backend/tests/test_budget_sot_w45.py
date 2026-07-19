"""W45: единый writer budget_planned = estimate + approved CO."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "budget_sot.db"
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


async def test_co_approve_does_not_double_count_planned():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)

        # sync SoT before measuring base
        summary_before = await client.get(f"/api/v1/projects/{pid}/os/budget", headers=h_cust)
        assert summary_before.status_code == 200, summary_before.text
        base = float(summary_before.json()["budget_planned"] or 0)

        created = await client.post(
            f"/api/v1/projects/{pid}/change-orders",
            headers=h_cont,
            json={"title": "Доп. розетки", "amount": 10000, "description": "W45"},
        )
        assert created.status_code == 200, created.text
        co_id = created.json()["id"]

        approved = await client.post(
            f"/api/v1/projects/{pid}/change-orders/{co_id}/approve",
            headers=h_cust,
        )
        assert approved.status_code == 200, approved.text

        summary_after = await client.get(f"/api/v1/projects/{pid}/os/budget", headers=h_cust)
        assert summary_after.status_code == 200
        planned = float(summary_after.json()["budget_planned"] or 0)
        assert abs(planned - (base + 10000)) < 0.02, (base, planned)

        # approve again should no-op / not double
        again = await client.post(
            f"/api/v1/projects/{pid}/change-orders/{co_id}/approve",
            headers=h_cust,
        )
        # may be 200 with null or 409 — either way planned must stay
        summary_final = await client.get(f"/api/v1/projects/{pid}/os/budget", headers=h_cust)
        planned2 = float(summary_final.json()["budget_planned"] or 0)
        assert abs(planned2 - planned) < 0.02, (planned, planned2, again.status_code)
