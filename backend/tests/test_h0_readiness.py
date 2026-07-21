"""W53: H0 staging readiness checklist."""
import pytest

pytestmark = pytest.mark.asyncio
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_demo import ensure_demo_users
from app.services.staging_readiness import build_h0_readiness

@pytest.mark.asyncio
async def test_build_h0_readiness_dev_shape(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "environment", "development")
    monkeypatch.setattr(config.settings, "public_base_url", "http://127.0.0.1:8100")
    monkeypatch.setattr(config.settings, "yookassa_shop_id", None)
    monkeypatch.setattr(config.settings, "yookassa_secret", None)
    snap = build_h0_readiness()
    assert "checks" in snap and len(snap["checks"]) >= 5
    assert snap["environment"] == "development"
    assert snap["ready_for_investor_demo"] is False  # not staging
    ids = {c["id"] for c in snap["checks"]}
    assert "auth_bearer" in ids
    auth = next(c for c in snap["checks"] if c["id"] == "auth_bearer")
    assert auth["ok"] is True  # development override


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "h0.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.core import config
    config.settings.database_url = url
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)


@pytest.mark.asyncio
async def test_h0_readiness_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        # Prefer Bearer (staging forbids X-User-Id)
        tok = (cont.get("access_token") or "").strip()
        assert tok, "demo must return access_token"
        r = await client.get(
            "/api/v1/admin/h0-readiness",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "score" in body
        assert "blockers" in body
        assert "checks" in body
        assert any(c["id"] == "auth_bearer" for c in body["checks"])
