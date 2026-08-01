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
    config.settings.auth_allow_header_user_id = None
    config.settings.allow_demo_seed = None
    config.settings.environment = "development"
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
        response = await client.post("/api/v1/auth/demo", json={"role": "customer"})
        assert response.status_code == 200
        body = response.json()
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
        assert me.json().get("access_token")


async def test_invalid_bearer_rejected():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer not-a-real-jwt"},
        )
        assert response.status_code == 401


async def test_header_user_id_allowed_in_dev_default():
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
        response = await client.get(
            "/api/v1/projects",
            headers={"Authorization": f"Bearer {demo['access_token']}"},
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)


async def test_demo_disabled_when_seed_forbidden(monkeypatch):
    config.settings.allow_demo_seed = False
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/v1/auth/demo", json={"role": "customer"})
            assert response.status_code == 404
    finally:
        config.settings.allow_demo_seed = None


async def test_register_blocked_outside_dev(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    config.settings.environment = "staging"
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/register",
                json={"phone": "+79001112233", "role": "customer"},
            )
            assert response.status_code == 403
            assert "sms" in response.json().get("detail", "").lower() or "registration" in response.json().get("detail", "")
    finally:
        config.settings.environment = "development"
        monkeypatch.setenv("ENVIRONMENT", "development")


async def test_otp_hides_demo_code_outside_dev(monkeypatch):
    from app.services import otp_service

    config.settings.environment = "production"
    monkeypatch.setattr(config.settings, "redis_url", None)
    try:
        result = await otp_service.send_otp("+79001234567")
        assert result.get("ok") is False
        assert result.get("service_unavailable") is True
        assert "demo_code" not in result
    finally:
        config.settings.environment = "development"


async def test_middleware_audit_reads_bearer():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        demo = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        config.settings.allow_demo_seed = None
        response = await client.get(
            "/api/v1/notifications",
            headers={"Authorization": f"Bearer {demo['access_token']}"},
        )
        assert response.status_code == 200


async def test_portal_session_mints_access_token():
    from app.services import portal_token_service as portal_tok

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        config.settings.auth_allow_header_user_id = False
        try:
            project_id = (await client.get(
                "/api/v1/projects",
                headers={"Authorization": f"Bearer {customer['access_token']}"},
            )).json()[0]["id"]
            token = portal_tok.create_portal_token(
                project_id=project_id,
                user_id=customer["id"],
                scopes=["read"],
            )
            session = await client.post("/api/v1/auth/portal/session", json={"token": token})
            assert session.status_code == 200
            body = session.json()
            assert body.get("access_token")
            snapshot = await client.get(
                f"/api/v1/portal/projects/{project_id}/snapshot",
                headers={"Authorization": f"Bearer {body['access_token']}"},
            )
            assert snapshot.status_code == 200
            blocked = await client.get(
                f"/api/v1/portal/projects/{project_id}/snapshot",
                headers={"X-User-Id": customer["id"]},
            )
            assert blocked.status_code == 401
        finally:
            config.settings.auth_allow_header_user_id = None
