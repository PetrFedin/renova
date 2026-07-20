"""W66: portal return, hub approve, schedule role-gate, propose TTL."""
from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import (
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    User,
    UserRole,
)
from app.services import estimate_service as est
from app.services import portal_token_service as portal_tok
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w66.db"
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


async def _seed_acceptance(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust = {"X-User-Id": cust["id"]}
    h_cont = {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
    # W66: demo ставит первый этап в review + pending acceptance
    pending = (await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_cust)).json()
    open_acc = next(
        (a for a in pending if a.get("status") in ("requested", "in_review", "pending")),
        None,
    )
    if open_acc:
        return pid, cust["id"], cont["id"], open_acc["id"], h_cust, h_cont
    stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
    stage = next((s for s in stages if s["status"] in ("active", "review")), stages[0])
    created = await client.post(
        f"/api/v1/projects/{pid}/work-acceptances",
        headers=h_cont,
        json={"stage_id": stage["id"], "comment": "готов"},
    )
    assert created.status_code == 200, created.text
    return pid, cust["id"], cont["id"], created.json()["id"], h_cust, h_cont



async def test_portal_return_stage_via_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, _, acc_id, _, _ = await _seed_acceptance(client)
        token = portal_tok.create_portal_token(
            project_id=pid, user_id=cust_id, ttl_hours=1, scopes=["read", "accept_stage"]
        )
        r = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/return",
            json={"token": token, "comment": "переделать швы"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "returned"


async def test_approvals_hub_approve_material():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, cont_id, _, h_cust, h_cont = await _seed_acceptance(client)
        # create pending pick as contractor
        pick = await client.post(
            f"/api/v1/projects/{pid}/material-picks",
            headers=h_cont,
            json={"name": "Плитка W66", "unit": "м2", "qty": 1, "price": 100},
        )
        assert pick.status_code == 200, pick.text
        pick_id = pick.json()["id"]
        # submit for approval if needed
        sub = await client.post(
            f"/api/v1/projects/{pid}/material-picks/{pick_id}/submit",
            headers=h_cont,
        )
        # submit may not exist — force pending via patch or approve path
        if sub.status_code >= 400:
            from app.db import session as sess
            async with sess.SessionLocal() as db:
                row = await db.get(MaterialPick, pick_id)
                assert row
                row.status = MaterialPickStatus.pending
                await db.commit()
        r = await client.post(
            f"/api/v1/projects/{pid}/approvals/{pick_id}/approve",
            headers=h_cust,
            json={"type": "material"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True


async def test_customer_cannot_create_schedule_when_contractor_assigned():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, _, _, _, h_cust, _ = await _seed_acceptance(client)
        r = await client.post(
            f"/api/v1/projects/{pid}/work-schedules",
            headers=h_cust,
            json={"title": "План от заказчика"},
        )
        assert r.status_code == 403
        assert "only_contractor" in r.text


async def test_proposal_stale_blocks_lock(db):
    cust = User(id="c-w66", phone="+79990006601", role=UserRole.customer)
    contr = User(id="k-w66", phone="+79990006602", role=UserRole.contractor)
    project = Project(
        id="p-w66",
        name="W66 TTL",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
        estimate_lock_proposed_at=datetime.utcnow() - timedelta(days=15),
        estimate_lock_proposed_by=contr.id,
    )
    line = EstimateLine(
        id="el-w66",
        project_id=project.id,
        line_type=LineType.work,
        name="Работа",
        unit="шт",
        quantity_planned=1,
        unit_price=100,
    )
    db.add_all([cust, contr, project, line])
    await db.commit()

    proj, result = await est.lock_estimate(db, project.id, locked_by=cust.id)
    assert result.get("code") == "proposal_stale"
    assert proj and proj.estimate_locked_at is None
