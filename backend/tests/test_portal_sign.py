"""P3-W6: portal magic link document sign."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import User, UserRole
from app.models.project_documents import DocumentStatus, DocumentType
from app.services import portal_token_service as portal_tok
from app.services import project_document_service as docs_svc
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "portal_sign.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.secret_key = "test-secret-key-32chars-min!!"
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess

    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_portal_sign_draft_document():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        pid = (await client.get("/api/v1/projects", headers={"X-User-Id": cust["id"]})).json()[0]["id"]
        token = portal_tok.create_portal_token(project_id=pid, user_id=cust["id"], scopes=["read", "sign_document"])
        async with __import__("app.db.session", fromlist=["SessionLocal"]).SessionLocal() as db:
            doc = await docs_svc.create_document(
                db,
                project_id=pid,
                created_by=cust["id"],
                title="Доп. работы: тест",
                document_type=DocumentType.contract.value,
            )
            doc.status = DocumentStatus.draft.value
            await db.commit()
            doc_id = doc.id
        r = await client.post(
            f"/api/v1/portal/projects/{pid}/documents/{doc_id}/sign",
            json={"token": token, "provider": "in_app"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
