"""P3-W10: estimate lock creates contract draft + blocks edits."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import init_db
from app.main import app
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "estimate_lock.db"
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


async def test_lock_estimate_creates_contract_draft():
    from app.db import session as sess
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        locked = await client.post(f"/api/v1/projects/{pid}/estimate/lock", headers=h_cont)
        assert locked.status_code == 200
        body = locked.json()
        assert body.get("estimate_locked_at")
        assert body.get("contract", {}).get("document_id")
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cont)).json()
        assert detail.get("estimate_locked_at")
        async with sess.SessionLocal() as db:
            doc = (await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == pid,
                    ProjectDocument.document_type == DocumentType.contract.value,
                )
            )).scalars().first()
            assert doc is not None
            assert doc.status == DocumentStatus.draft.value
        gate = await client.get(f"/api/v1/projects/{pid}/contract-gate", headers=h_cust)
        assert gate.json().get("ok") is False


async def test_lock_blocks_estimate_patch():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers={"X-User-Id": cust["id"]})).json()[0]["id"]
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cont)).json()
        line_id = detail["estimate_lines"][0]["id"]
        await client.post(f"/api/v1/projects/{pid}/estimate/lock", headers=h_cont)
        blocked = await client.patch(
            f"/api/v1/projects/{pid}/estimate/lines/{line_id}",
            headers=h_cont,
            json={"unit_price": 999},
        )
        assert blocked.status_code == 409
        assert blocked.json().get("detail", {}).get("code") == "estimate_locked"


async def test_customer_can_lock_estimate():
    """P0.4 / W48: заказчик согласует и фиксирует базовую смету."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        locked = await client.post(f"/api/v1/projects/{pid}/estimate/lock", headers=h_cust)
        assert locked.status_code == 200, locked.text
        assert locked.json().get("estimate_locked_at")
