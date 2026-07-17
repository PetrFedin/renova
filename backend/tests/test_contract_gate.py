"""P3-W7/W9: contract gate blocks stage start + read endpoint."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import init_db
from app.main import app
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.services import project_document_service as docs_svc
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "contract_gate.db"
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



async def test_start_stage_blocked_without_signed_contract():
    from app.db import session as sess
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cont = {"X-User-Id": cont["id"]}
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cont)).json()
        planned = next((s for s in detail["stages"] if s["status"] == "planned"), None)
        assert planned
        stage_id = planned["id"]
        async with sess.SessionLocal() as db:
            await docs_svc.create_document(
                db,
                project_id=pid,
                created_by=cust["id"],
                title="Договор подряда",
                document_type=DocumentType.contract.value,
            )
            doc = (await db.execute(select(ProjectDocument).where(ProjectDocument.project_id == pid))).scalars().first()
            doc.status = DocumentStatus.draft.value
            await db.commit()
        blocked = await client.post(f"/api/v1/projects/{pid}/stages/{stage_id}/start", headers=h_cont)
        assert blocked.status_code == 403
        detail_obj = blocked.json().get("detail", blocked.json())
        assert detail_obj.get("code") == "contract_not_signed"
        assert "Договор подряда" in (detail_obj.get("pending_titles") or [])


async def test_contract_gate_read_endpoint():
    from app.db import session as sess
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        ok = await client.get(f"/api/v1/projects/{pid}/contract-gate", headers=h_cust)
        assert ok.status_code == 200
        assert ok.json().get("ok") is True
        async with sess.SessionLocal() as db:
            await docs_svc.create_document(
                db,
                project_id=pid,
                created_by=cust["id"],
                title="Договор",
                document_type=DocumentType.contract.value,
            )
            doc = (await db.execute(select(ProjectDocument).where(ProjectDocument.project_id == pid))).scalars().first()
            doc.status = DocumentStatus.draft.value
            await db.commit()
        pending = await client.get(f"/api/v1/projects/{pid}/contract-gate", headers=h_cust)
        assert pending.status_code == 200
        body = pending.json()
        assert body.get("ok") is False
        assert body.get("code") == "contract_not_signed"
