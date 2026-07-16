"""Regression: единый канон приёмки — legacy 410, work-acceptances golden path."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db, SessionLocal
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "acceptance_canon.db"
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


async def _demo_project(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust = {"X-User-Id": cust["id"]}
    h_cont = {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
    return pid, h_cust, h_cont


async def test_legacy_accept_returns_410():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active = next(s for s in stages if s["status"] == "active")
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"], "comment": "готов"},
        )
        r = await client.post(
            f"/api/v1/projects/{pid}/stages/{active['id']}/accept",
            headers=h_cust,
        )
        assert r.status_code == 410
        assert r.headers.get("x-deprecated-use") == "work-acceptances"


async def test_work_acceptance_canon_accept():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active = next(s for s in stages if s["status"] == "active")
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"], "comment": "готов"},
        )
        assert created.status_code == 200
        acc_id = created.json()["id"]
        accepted = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"quality_score": 10, "comment": "ок"},
        )
        assert accepted.status_code == 200
        assert accepted.json()["status"] in ("accepted", "accepted_with_remarks")


async def test_os_acceptance_proxy_uses_canon():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active = next(s for s in stages if s["status"] == "active")
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"]},
        )
        acc_id = created.json()["id"]
        r = await client.post(
            f"/api/v1/projects/{pid}/acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"with_remarks": False, "comment": "via os proxy"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"
