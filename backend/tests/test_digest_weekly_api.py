"""W51: preview + push weekly digest API."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "digest.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    config.settings.ollama_digest_enabled = False
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_preview_and_push_digest():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        prev = await client.get(f"/api/v1/projects/{pid}/digest/weekly/preview", headers=h)
        assert prev.status_code == 200, prev.text
        body = prev.json()
        assert body.get("source") == "rule"
        assert "body" in body and len(body["body"]) > 20
        pushed = await client.post(f"/api/v1/projects/{pid}/digest/weekly", headers=h)
        assert pushed.status_code == 200, pushed.text
        out = pushed.json()
        assert out.get("ok") is True
        assert out.get("notified", 0) >= 1
        assert out.get("document_id")
