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


async def test_accept_emits_acceptance_passed_with_stage_context():
    """W44: AcceptancePassed must carry stage_id into automation via log_event."""
    from unittest.mock import AsyncMock, patch

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
        acc_id = created.json()["id"]

        with patch("app.services.automation_engine.process_event", new_callable=AsyncMock) as pe:
            accepted = await client.post(
                f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
                headers=h_cust,
                json={"quality_score": 9, "comment": "ок"},
            )
            assert accepted.status_code == 200
            passed_calls = [c for c in pe.await_args_list if c.kwargs.get("kind") == "AcceptancePassed"]
            assert passed_calls, pe.await_args_list
            assert passed_calls[0].kwargs.get("stage_id") == active["id"]

        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = next(s for s in detail["stages"] if s["id"] == active["id"])
        assert stage["status"] == "done"
        assert stage.get("customer_accepted_at")


async def test_schedule_item_accepted_does_not_bypass_work_acceptance():
    """W44: schedule status=accepted → review, без customer_accepted_at."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active_id = next(s for s in stages if s["status"] == "active")["id"]
        created = await client.post(
            f"/api/v1/projects/{pid}/work-schedules",
            headers=h_cont,
            json={},
        )
        if created.status_code not in (200, 201):
            pytest.skip(f"work-schedules create unavailable: {created.status_code} {created.text}")
        sched = created.json()
        items = sched.get("items") or []
        item = next((i for i in items if i.get("stage_id") == active_id), items[0] if items else None)
        if not item:
            pytest.skip("no schedule items")
        upd = await client.post(
            f"/api/v1/projects/{pid}/work-schedules/{sched['id']}/items/{item['id']}/status",
            headers=h_cont,
            json={"status": "accepted"},
        )
        assert upd.status_code < 400, upd.text

        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = next(s for s in detail["stages"] if s["id"] == active_id)
        assert stage["status"] == "review", stage
        assert not stage.get("customer_accepted_at"), "schedule must not set customer_accepted_at"
