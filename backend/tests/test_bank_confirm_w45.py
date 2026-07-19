"""W45: bank match → confirm payment."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "bank_confirm.db"
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


async def test_bank_confirm_pending_after_acceptance():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)

        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active = next(s for s in stages if s["status"] == "active")
        # request + accept → pending stage payment
        acc = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"]},
        )
        assert acc.status_code == 200
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc.json()['id']}/accept",
            headers=h_cust,
            json={"comment": "ок"},
        )
        pays = (await client.get(f"/api/v1/projects/{pid}/payments", headers=h_cust)).json()
        pending = [p for p in pays if p.get("status") == "pending" and p.get("stage_id") == active["id"]]
        assert pending, pays
        amount = pending[0]["amount"]
        pay_id = pending[0]["id"]

        csv = f"19.07.2026;{amount};Оплата этапа"
        matched = await client.post(
            f"/api/v1/projects/{pid}/import/bank-statement",
            headers=h_cust,
            json={"csv_text": csv},
        )
        assert matched.status_code == 200, matched.text
        body = matched.json()
        assert body["matched"] >= 1
        ids = [m["payment_id"] for m in body["matches"] if m.get("payment_status") == "pending"]
        assert pay_id in ids

        conf = await client.post(
            f"/api/v1/projects/{pid}/import/bank-statement/confirm",
            headers=h_cust,
            json={"payment_ids": [pay_id]},
        )
        assert conf.status_code == 200, conf.text
        assert conf.json()["confirmed_count"] == 1

        pays2 = (await client.get(f"/api/v1/projects/{pid}/payments", headers=h_cust)).json()
        row = next(p for p in pays2 if p["id"] == pay_id)
        assert row["status"] == "confirmed"
