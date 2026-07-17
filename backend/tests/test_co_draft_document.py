"""P3.2d: CO approve → draft document stub."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.models.project_documents import DocumentStatus
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "co_draft.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config

    config.settings.database_url = url
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


async def test_co_approve_creates_draft_document():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_cust = {"X-User-Id": cust["id"]}
        h_cont = {"X-User-Id": cont["id"]}
        pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
        await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
        created = await client.post(
            f"/api/v1/projects/{pid}/change-orders",
            headers=h_cont,
            json={"title": "Перенос розеток", "amount": 12000, "description": "Доп"},
        )
        assert created.status_code == 200
        co_id = created.json()["id"]
        approved = await client.post(
            f"/api/v1/projects/{pid}/change-orders/{co_id}/approve",
            headers=h_cust,
        )
        assert approved.status_code == 200
        payload = (await client.get(f"/api/v1/projects/{pid}/documents", headers=h_cust)).json()
        items = payload.get("items") or []
        draft = next((d for d in items if d.get("title") == "Доп. работы: Перенос розеток"), None)
        assert draft is not None
        assert draft.get("status") == DocumentStatus.draft.value
