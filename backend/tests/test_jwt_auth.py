"""P0: JWT Bearer auth — SoT for production; X-User-Id only when allow_header."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config
from app.db.session import init_db
from app.main import app
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "jwt_auth.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    # Reset override between tests
    config.settings.auth_allow_header_user_id = None
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


async def test_demo_login_returns_access_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/demo", json={"role": "customer"})
        assert r.status_code == 200
        body = r.json()
        assert body.get("access_token")
        assert body.get("token_type") == "bearer"
        assert body.get("id")


async def test_bearer_token_authorizes_me():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        demo = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        token = demo["access_token"]
        me = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        assert me.json()["id"] == demo["id"]
        # No X-User-Id required when Bearer present
        assert me.json().get("access_token")


async def test_invalid_bearer_rejected():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer not-a-real-jwt"},
        )
        assert r.status_code == 401


async def test_header_user_id_allowed_in_dev_default():
    """development/test policy: X-User-Id still works for local/pytest."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        demo = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        me = await client.get(
            "/api/v1/auth/me",
            headers={"X-User-Id": demo["id"]},
        )
        assert me.status_code == 200
        assert me.json()["id"] == demo["id"]


async def test_header_user_id_rejected_when_strict():
    """Staging/production style: AUTH_ALLOW_HEADER_USER_ID=false."""
    config.settings.auth_allow_header_user_id = False
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            demo = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
            blocked = await client.get(
                "/api/v1/auth/me",
                headers={"X-User-Id": demo["id"]},
            )
            assert blocked.status_code == 401
            assert "Bearer" in blocked.json().get("detail", "")

            ok = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {demo['access_token']}"},
            )
            assert ok.status_code == 200
            assert ok.json()["id"] == demo["id"]
    finally:
        config.settings.auth_allow_header_user_id = None


async def test_bearer_lists_projects():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        demo = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        r = await client.get(
            "/api/v1/projects",
            headers={"Authorization": f"Bearer {demo['access_token']}"},
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)
