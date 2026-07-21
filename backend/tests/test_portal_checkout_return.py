"""P3-W10: portal YuKassa checkout uses web return URL with paid=1."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services import portal_token_service as portal_tok
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "portal_checkout.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    sess.engine = __import__("sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def test_portal_checkout_return_url_contains_paid():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        h = {"X-User-Id": cust["id"]}
        pid = (await client.get("/api/v1/projects", headers=h)).json()[0]["id"]
        token = portal_tok.create_portal_token(project_id=pid, user_id=cust["id"], scopes=["read"])
        payments = (await client.get(f"/api/v1/projects/{pid}/payments", headers=h)).json()
        pending = next((p for p in payments if p["status"] == "pending"), None)
        assert pending, "expected pending payment in demo"
        checkout = await client.post(
            f"/api/v1/projects/{pid}/payments/{pending['id']}/yookassa-checkout",
            headers=h,
            json={"portal_token": token},
        )
        assert checkout.status_code == 200
        url = checkout.json().get("confirmation_url") or ""
        assert "paid=1" in url
        assert "portal" in url
        assert token in url
