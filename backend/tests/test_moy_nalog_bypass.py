"""My Nalog: production-safe bypass guards + audit note."""
from __future__ import annotations

import pytest
from app.core.config import settings
from app.core.environment import validate_runtime_settings
from app.services.moy_nalog_capability import moy_nalog_capability, moy_nalog_dev_bypass_allowed


@pytest.fixture(autouse=True)
def _restore_flags():
    prev_env = settings.environment
    prev_bypass = settings.moy_nalog_dev_bypass_enabled
    prev_enabled = settings.moy_nalog_enabled
    prev_secret = settings.moy_nalog_client_secret
    yield
    settings.environment = prev_env
    settings.moy_nalog_dev_bypass_enabled = prev_bypass
    settings.moy_nalog_enabled = prev_enabled
    settings.moy_nalog_client_secret = prev_secret


def test_production_bypass_env_true_still_forbidden():
    settings.environment = "production"
    settings.moy_nalog_dev_bypass_enabled = True
    assert moy_nalog_dev_bypass_allowed() is False


def test_development_bypass_env_false_forbidden():
    settings.environment = "development"
    settings.moy_nalog_dev_bypass_enabled = False
    assert moy_nalog_dev_bypass_allowed() is False


def test_development_bypass_env_true_allowed():
    settings.environment = "development"
    settings.moy_nalog_dev_bypass_enabled = True
    assert moy_nalog_dev_bypass_allowed() is True


def test_staging_validate_rejects_bypass_flag():
    with pytest.raises(ValueError) as ei:
        validate_runtime_settings(
            environment="staging",
            database_url="postgresql+asyncpg://u:p@db/r",
            public_base_url="https://api-staging.example.com",
            secret_key="staging-secret-key-32chars-ok!!",
            moy_nalog_dev_bypass_enabled=True,
        )
    assert "MY_NALOG_DEV_BYPASS_ENABLED" in str(ei.value)


def test_capability_hides_secrets():
    settings.environment = "development"
    settings.moy_nalog_dev_bypass_enabled = True
    settings.moy_nalog_client_secret = "super-secret-value"
    cap = moy_nalog_capability()
    blob = str(cap)
    assert "super-secret-value" not in blob
    assert "client_secret" not in blob
    assert "dev_bypass_available" in cap
    assert cap["dev_bypass_available"] is True


@pytest.mark.asyncio
async def test_link_forbidden_in_production_returns_403(monkeypatch):
    """ASGI smoke: production + bypass flag → 403 (не 501/200)."""
    settings.environment = "production"
    settings.moy_nalog_dev_bypass_enabled = True
    settings.moy_nalog_enabled = False

    # Use demo auth only works in allow_demo_seed — production forbids demo.
    # Instead call dependency-injected path via TestClient with header if allowed.
    # For production header auth is off — unit-test the guard function + HTTPException path.
    from fastapi import HTTPException
    from app.api.v1 import fns as fns_api
    from unittest.mock import AsyncMock, MagicMock

    user = MagicMock()
    user.id = "u-prod"
    user.moy_nalog_linked = False
    user.moy_nalog_status = "not_connected"
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    with pytest.raises(HTTPException) as ei:
        await fns_api.link_moy_nalog(user=user, db=db)
    assert ei.value.status_code == 403
    detail = ei.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "moy_nalog_bypass_forbidden"
    # audit: AuditLog добавлен без секретов
    assert db.add.called, "ожидали audit log на запрещённый bypass"
    logged = db.add.call_args[0][0]
    path = getattr(logged, "path", "") or ""
    assert "moy_nalog_bypass_denied" in path
    assert "secret" not in path.lower()
    assert "token" not in path.lower()
