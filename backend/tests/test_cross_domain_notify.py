"""P0.3: CO / payment / document actions create notifications + digest includes CO."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import init_db, SessionLocal
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users
from tests.helpers_flow import complete_stage_checklist

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "notify.db"
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
    return pid, cust, cont, h_cust, h_cont


async def test_change_order_create_notifies_customer():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust, cont, h_cust, h_cont = await _demo_project(client)
        r = await client.post(
            f"/api/v1/projects/{pid}/change-orders",
            headers=h_cont,
            json={"title": "Доп. розетки", "amount": 12000, "description": "кухня"},
        )
        assert r.status_code == 200
        notes = await client.get("/api/v1/notifications", headers=h_cust)
        assert notes.status_code == 200
        items = notes.json()
        assert any(n.get("notification_type") == "change_order" for n in items)


async def test_payment_confirm_notifies_contractor():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust, cont, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        active = next((s for s in stages if s["status"] in ("active", "review")), None); assert active, [s.get("status") for s in stages]
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": active["id"]},
        )
        accs = (await client.get(f"/api/v1/projects/{pid}/work-acceptances", headers=h_cust)).json()
        acc_id = next(a["id"] for a in accs if a["stage_id"] == active["id"])
        await complete_stage_checklist(client, pid, active["id"], h_cont)
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"quality_score": 10},
        )
        payments = (await client.get(f"/api/v1/projects/{pid}/payments", headers=h_cust)).json()
        pending = next(p for p in payments if p["status"] == "pending")
        confirm = await client.post(
            f"/api/v1/projects/{pid}/payments/{pending['id']}/confirm",
            headers=h_cust,
            json={"transfer_ack": True},
        )
        assert confirm.status_code == 200
        notes = await client.get("/api/v1/notifications", headers=h_cont)
        assert notes.status_code == 200
        items = notes.json()
        assert any("Оплата" in (n.get("title") or "") for n in items)


async def test_approval_digest_includes_change_order():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust, cont, h_cust, h_cont = await _demo_project(client)
        await client.post(
            f"/api/v1/projects/{pid}/change-orders",
            headers=h_cont,
            json={"title": "Перегородка", "amount": 8000},
        )
        digest = await client.get("/api/v1/notifications/approval-digest", headers=h_cust)
        assert digest.status_code == 200
        data = digest.json()
        assert data["count"] >= 1
        assert any(i.get("notification_type") == "change_order" for i in data["items"])


async def test_document_archive_notifies_customer():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, cust, cont, h_cust, h_cont = await _demo_project(client)
        created = await client.post(
            f"/api/v1/projects/{pid}/documents",
            headers=h_cont,
            json={"title": "Тестовый акт", "document_type": "upload"},
        )
        assert created.status_code == 200
        doc_id = created.json()["id"]
        r = await client.post(
            f"/api/v1/projects/{pid}/documents/{doc_id}/archive",
            headers=h_cont,
        )
        assert r.status_code == 200
        notes = await client.get("/api/v1/notifications", headers=h_cust)
        assert notes.status_code == 200
        items = notes.json()
        assert any(n.get("notification_type") == "document" for n in items)
