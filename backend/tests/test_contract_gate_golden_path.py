"""P3-W11: golden path estimate lock → sign contract → start stage."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import lock_estimate_w57

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "gate_golden.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    from app.db import session as sess
    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _setup_project(client):
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    h_cont = {"X-User-Id": cont["id"]}
    h_cust = {"X-User-Id": cust["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
    detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cont)).json()
    planned = next((s for s in detail["stages"] if s["status"] == "planned"), None)
    assert planned, "expected planned stage"
    return pid, planned["id"], h_cont, h_cust, cust["id"]


async def test_golden_path_lock_sign_start_stage():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, stage_id, h_cont, h_cust, cust_id = await _setup_project(client)
        locked = await lock_estimate_w57(client, pid, h_cont, h_cust)
        doc_id = locked.json()["contract"]["document_id"]
        blocked = await client.post(f"/api/v1/projects/{pid}/stages/{stage_id}/start", headers=h_cont)
        assert blocked.status_code == 403
        signed = await client.post(
            f"/api/v1/projects/{pid}/documents/{doc_id}/sign",
            headers=h_cust,
            json={"provider": "in_app"},
        )
        assert signed.status_code == 200, signed.text
        gate = await client.get(f"/api/v1/projects/{pid}/contract-gate", headers=h_cont)
        assert gate.json().get("ok") is True
        started = await client.post(f"/api/v1/projects/{pid}/stages/{stage_id}/start", headers=h_cont)
        assert started.status_code == 200, started.text
        assert started.json().get("status") == "active"
