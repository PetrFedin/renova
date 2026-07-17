"""P3-W4: portal magic link accept stage."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db, SessionLocal
from app.main import app
from app.models.entities import AcceptanceStatus, Project, Stage, StageStatus, User, UserRole, WorkAcceptance
from app.services import portal_token_service as portal_tok
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "portal_accept.db"
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
    stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
    active = next(s for s in stages if s["status"] == "active")
    created = await client.post(
        f"/api/v1/projects/{pid}/work-acceptances",
        headers=h_cont,
        json={"stage_id": active["id"], "comment": "готов"},
    )
    assert created.status_code == 200
    return pid, cust["id"], created.json()["id"], active["id"]


async def test_portal_accept_stage_via_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, acc_id, stage_id = await _seed_acceptance(client)
        token = portal_tok.create_portal_token(
            project_id=pid, user_id=cust_id, ttl_hours=1, scopes=["read", "accept_stage"]
        )
        r = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token, "comment": "ок с портала"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in ("accepted", "accepted_with_remarks")
        assert body["stage_id"] == stage_id


async def test_portal_accept_rejects_read_only_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, acc_id, _ = await _seed_acceptance(client)
        token = portal_tok.create_portal_token(project_id=pid, user_id=cust_id, ttl_hours=1)
        r = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token},
        )
        assert r.status_code == 403
