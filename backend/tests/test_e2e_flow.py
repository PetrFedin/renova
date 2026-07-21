"""E2E smoke: demo login → приёмка → оплата."""
import pytest
from httpx import ASGITransport, AsyncClient
from app.db.session import init_db, SessionLocal
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import complete_stage_checklist
from app.services.seed_articles import seed_articles
from app.main import app

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config
    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    from app.db import session as sess
    sess.engine = __import__('sqlalchemy.ext.asyncio', fromlist=['create_async_engine']).create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = __import__('sqlalchemy.ext.asyncio', fromlist=['async_sessionmaker']).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_demo_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        assert cust.get("id")
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers={"X-User-Id": cont["id"]})
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h)).json()["stages"]
        active = next(s for s in stages if s["status"] in ("active", "review"))
        h_cont = {"X-User-Id": cont["id"]}
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"], "comment": "готов"},
        )
        acc_id = created.json()["id"]
        await complete_stage_checklist(client, pid, active["id"], h_cont)
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h,
            json={"quality_score": 10},
        )
        assert (await client.get(f"/api/v1/projects/{pid}/calendar", headers=h)).json()["events"]
        assert (await client.get(f"/api/v1/projects/{pid}/chats", headers=h)).json()
        r = await client.post(
            f"/api/v1/projects/{pid}/receipts/scan",
            headers={"X-User-Id": cont["id"]},
            json={"qr_raw": "t=20260627T1200&s=1500.00&fn=9999078901234567&i=12345&fp=1234567890&n=1"},
        )
        assert r.status_code == 200
        pdf = await client.get(f"/api/v1/projects/{pid}/estimate.pdf", headers=h)
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
