"""W71: hub CO → budget + sign draft; estimate CSV import."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w71.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.secret_key = "test-secret-key-32chars-min!!"
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_hub_approve_change_order_updates_budget_and_doc():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)

        before = (await client.get(f"/api/v1/projects/{pid}/os/budget", headers=h_cust)).json()
        planned0 = float(before.get("budget_planned") or 0)

        co = await client.post(
            f"/api/v1/projects/{pid}/change-orders",
            headers=h_cont,
            json={"title": "Доп розетки", "amount": 15000, "description": "W71"},
        )
        assert co.status_code == 200, co.text
        oid = co.json()["id"]

        # Hub approve (ранее не обновлял бюджет)
        hub = await client.post(
            f"/api/v1/projects/{pid}/approvals/{oid}/approve",
            headers=h_cust,
            json={"type": "change_order"},
        )
        assert hub.status_code == 200, hub.text
        body = hub.json()
        assert body.get("budget_updated") is True
        assert body.get("document_id")

        after = (await client.get(f"/api/v1/projects/{pid}/os/budget", headers=h_cust)).json()
        assert float(after["budget_planned"]) >= planned0 + 15000 - 0.01
        assert after.get("change_orders_approved_sum", 0) >= 15000 - 0.01
        assert any(c["id"] == oid and c["status"] == "approved" for c in after.get("change_orders") or [])


async def test_estimate_csv_import():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)

        csv_text = (
            "name,line_type,unit,quantity_planned,unit_price,room_name\n"
            "Плитка,material,м2,10,1200,Ванная\n"
            "Укладка,work,м2,10,800,Ванная\n"
        )
        r = await client.post(
            f"/api/v1/projects/{pid}/estimate/import-csv",
            headers=h_cont,
            json={"csv_text": csv_text},
        )
        assert r.status_code == 200, r.text
        assert r.json()["created"] == 2
