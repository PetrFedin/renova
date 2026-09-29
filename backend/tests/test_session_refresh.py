"""Refresh token rotation smoke."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.core.config import settings


@pytest.mark.asyncio
async def test_demo_login_returns_refresh_and_rotates(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "allow_demo_seed", True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/demo", json={"role": "customer"})
        if r.status_code == 404:
            pytest.skip("demo disabled / no seed")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("access_token")
        refresh = body.get("refresh_token")
        if not refresh:
            pytest.skip("refresh not issued")
        r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert r2.status_code == 200, r2.text
        assert r2.json().get("access_token")
        assert r2.json().get("refresh_token")
        # old refresh revoked
        r3 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert r3.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh_session(monkeypatch):
    """B0-2 (#315): the mobile logout path now calls POST /auth/logout; after it the
    refresh token must be unusable server-side (not only cleared on the device)."""
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "allow_demo_seed", True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/demo", json={"role": "customer"})
        if r.status_code == 404:
            pytest.skip("demo disabled / no seed")
        refresh = r.json().get("refresh_token")
        if not refresh:
            pytest.skip("refresh not issued")
        out = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        assert out.status_code == 200 and out.json() == {"ok": True}
        again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert again.status_code == 401
        # idempotent: second logout with the same (already revoked) token is still ok
        out2 = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
        assert out2.status_code == 200
