"""P3-W4: portal magic link accept stage."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db, SessionLocal
from app.main import app
from app.models.entities import AcceptanceStatus, Project, Stage, StageStatus, User, UserRole, WorkAcceptance
from app.services import portal_link_service as portal_links
from app.services import portal_token_service as portal_tok
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import complete_stage_checklist, self_assign

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
    await self_assign(client, pid, h_cont)
    # Demo: первый этап уже в review с pending acceptance
    pending = (await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_cust)).json()
    open_acc = next(
        (a for a in pending if a.get("status") in ("requested", "in_review", "pending")),
        None,
    )
    if open_acc:
        return pid, cust["id"], open_acc["id"], open_acc.get("stage_id")
    stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
    stage = next((s for s in stages if s["status"] in ("active", "review")), stages[0])
    created = await client.post(
        f"/api/v1/projects/{pid}/work-acceptances",
        headers=h_cont,
        json={"stage_id": stage["id"], "comment": "готов"},
    )
    assert created.status_code == 200
    return pid, cust["id"], created.json()["id"], stage["id"]


async def _issue_accept_link(project_id: str, customer_id: str):
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        link, token = await portal_links.issue_link(
            db,
            project_id=project_id,
            user_id=customer_id,
            issued_by=customer_id,
            scopes=["read", "accept_stage"],
            ttl_hours=1,
        )
        return link.id, token


async def test_portal_accept_stage_via_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, acc_id, stage_id = await _seed_acceptance(client)
        # Portal accept has no checklist body — mark items done first (full → quick).
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        await complete_stage_checklist(client, pid, stage_id, {"X-User-Id": cont["id"]})
        _, token = await _issue_accept_link(pid, cust_id)
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



async def test_portal_accept_replay_is_gone_and_cross_project_is_hidden():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, acc_id, stage_id = await _seed_acceptance(client)
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        await complete_stage_checklist(client, pid, stage_id, {"X-User-Id": cont["id"]})
        _, token = await _issue_accept_link(pid, cust_id)

        hidden = await client.post(
            f"/api/v1/portal/projects/not-{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token},
        )
        assert hidden.status_code == 404
        assert hidden.json()["detail"] == "project_not_found"

        first = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token, "comment": "одно решение"},
        )
        assert first.status_code == 200, first.text

        replay = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token, "comment": "повтор"},
        )
        assert replay.status_code == 410
        assert replay.json()["detail"] == "portal_decision_already_used"


async def test_revoked_or_legacy_write_token_cannot_decide_acceptance():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust_id, acc_id, _ = await _seed_acceptance(client)
        link_id, token = await _issue_accept_link(pid, cust_id)

        from app.db import session as sess

        async with sess.SessionLocal() as db:
            link = await db.get(__import__("app.models.entities", fromlist=["PortalLink"]).PortalLink, link_id)
            assert link is not None
            await portal_links.revoke_link(db, link)

        revoked = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": token},
        )
        assert revoked.status_code == 410
        assert revoked.json()["detail"] == "portal_link_inactive"

        legacy = portal_tok.create_portal_token(
            project_id=pid,
            user_id=cust_id,
            ttl_hours=1,
            scopes=["read", "accept_stage"],
        )
        legacy_write = await client.post(
            f"/api/v1/portal/projects/{pid}/work-acceptances/{acc_id}/accept",
            json={"token": legacy},
        )
        assert legacy_write.status_code == 410
        assert legacy_write.json()["detail"] == "portal_link_inactive"
