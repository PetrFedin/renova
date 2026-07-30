from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.entities import User, UserRole
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import moy_nalog_oauth as oauth
from app.services.moy_nalog_truth_repair import repair_legacy_moy_nalog_truth


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def ping(self):
        return True

    def setex(self, key, ttl, value):
        self.values[key] = str(value)
        self.ttls[key] = int(ttl)
        return True

    def get(self, key):
        return self.values.get(key)

    def delete(self, key):
        existed = key in self.values
        self.values.pop(key, None)
        self.ttls.pop(key, None)
        return int(existed)


@pytest_asyncio.fixture
async def repair_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture(autouse=True)
def configured_oauth(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(settings, "moy_nalog_enabled", True)
    monkeypatch.setattr(settings, "moy_nalog_client_id", "client-id")
    monkeypatch.setattr(settings, "moy_nalog_client_secret", "client-secret")
    monkeypatch.setattr(settings, "moy_nalog_authorize_url", "https://auth.example.test/oauth")
    monkeypatch.setattr(settings, "moy_nalog_token_url", "https://auth.example.test/token")
    monkeypatch.setattr(settings, "moy_nalog_redirect_uri", "https://app.example.test/callback")
    monkeypatch.setattr(settings, "redis_url", "redis://redis.example.test/0")
    monkeypatch.setattr(settings, "secret_key", "test-secret-key-long-enough")
    monkeypatch.setattr(oauth, "_redis", fake)
    monkeypatch.setattr(oauth, "_redis_failed", False)
    return fake


@pytest.mark.asyncio
async def test_legacy_flags_are_repaired_but_active_encrypted_connection_survives(
    repair_db,
    configured_oauth,
):
    admin = User(
        id="moy-admin",
        phone="+79990000001",
        role=UserRole.contractor,
        moy_nalog_linked=True,
        moy_nalog_status="admin_enabled",
    )
    stale = User(
        id="moy-stale",
        phone="+79990000002",
        role=UserRole.contractor,
        moy_nalog_linked=True,
        moy_nalog_status="connected",
    )
    active = User(
        id="moy-active",
        phone="+79990000003",
        role=UserRole.contractor,
        moy_nalog_linked=True,
        moy_nalog_status="connected",
    )
    repair_db.add_all([admin, stale, active])
    await repair_db.flush()
    await oauth.store_tokens(
        active.id,
        {
            "access_token": "active-access-token",
            "refresh_token": "active-refresh-token",
            "token_type": "Bearer",
            "expires_in": 3600,
        },
    )

    result = await repair_legacy_moy_nalog_truth(repair_db)
    await repair_db.commit()

    assert result == {"users_repaired": 2, "connections_preserved": 1}
    assert admin.moy_nalog_linked is False
    assert admin.moy_nalog_status == "not_connected"
    assert stale.moy_nalog_linked is False
    assert stale.moy_nalog_status == "token_expired"
    assert active.moy_nalog_linked is True
    assert active.moy_nalog_status == "connected"

    replay = await repair_legacy_moy_nalog_truth(repair_db)
    assert replay == {"users_repaired": 0, "connections_preserved": 1}


@pytest.mark.asyncio
async def test_disabled_integration_clears_connected_without_claiming_token_access(
    repair_db,
    configured_oauth,
    monkeypatch,
):
    user = User(
        id="moy-disabled",
        phone="+79990000004",
        role=UserRole.contractor,
        moy_nalog_linked=True,
        moy_nalog_status="connected",
    )
    repair_db.add(user)
    await repair_db.flush()
    monkeypatch.setattr(settings, "moy_nalog_enabled", False)

    result = await repair_legacy_moy_nalog_truth(repair_db)

    assert result == {"users_repaired": 1, "connections_preserved": 0}
    assert user.moy_nalog_linked is False
    assert user.moy_nalog_status == "token_expired"
