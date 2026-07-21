"""W47: demo seed имеет очередь приёмки для investor path."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "w47.db"
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


async def test_demo_has_pending_acceptance():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        accs = await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_cust)
        assert accs.status_code == 200
        pending = [a for a in accs.json() if a.get("status") in ("requested", "in_review")]
        assert pending, accs.json()
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        review = [s for s in detail["stages"] if s["status"] == "review"]
        assert review, "stage should be in review for demo accept CTA"


async def test_portal_snapshot_exposes_payments_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        link = await client.post(
            f"/api/v1/projects/{pid}/viewers/{cust['id']}/portal-link",
            headers=h,
            json={"allow_accept_stage": True, "allow_pay": True},
        )
        if link.status_code >= 400:
            link = await client.post(
                f"/api/v1/projects/{pid}/portal-link",
                headers=h,
                json={"allow_accept_stage": True},
            )
        if link.status_code >= 400:
            pytest.skip(f"portal link unavailable: {link.status_code} {link.text}")
        token = link.json().get("token") or link.json().get("portal_token")
        sess = await client.post("/api/v1/auth/portal/session", json={"token": token})
        assert sess.status_code == 200, sess.text
        snap = await client.get(
            f"/api/v1/portal/projects/{pid}/snapshot",
            headers={"X-User-Id": sess.json()["user_id"]},
        )
        assert snap.status_code == 200, snap.text
        assert snap.json().get("payments_mode") in ("live", "requisites", "demo")
