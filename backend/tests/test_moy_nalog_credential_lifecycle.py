from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest

from app.core import runtime_preflight
from app.core.config import settings
from app.services import moy_nalog_oauth as oauth


_KEY_A = "moy-nalog-encryption-key-a-00000000000000000001"
_KEY_B = "moy-nalog-encryption-key-b-00000000000000000002"
_OLD_SHARED = "legacy-shared-signing-secret-000000000000000003"


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def ping(self):
        return True

    def set(self, key, value, *, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = str(value)
        if ex is not None:
            self.ttls[key] = int(ex)
        return True

    def setex(self, key, ttl, value):
        self.values[key] = str(value)
        self.ttls[key] = int(ttl)
        return True

    def get(self, key):
        return self.values.get(key)

    def ttl(self, key):
        return self.ttls.get(key, -2)

    def delete(self, key):
        existed = key in self.values
        self.values.pop(key, None)
        self.ttls.pop(key, None)
        return int(existed)

    def eval(self, _script, _numkeys, key, expected):
        if self.values.get(key) == expected:
            self.delete(key)
            return 1
        return 0


@pytest.fixture(autouse=True)
def configured_oauth(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(settings, "environment", "test")
    monkeypatch.setattr(settings, "moy_nalog_enabled", True)
    monkeypatch.setattr(settings, "moy_nalog_client_id", "client-id")
    monkeypatch.setattr(settings, "moy_nalog_client_secret", "client-secret")
    monkeypatch.setattr(settings, "moy_nalog_authorize_url", "https://auth.example.test/oauth")
    monkeypatch.setattr(settings, "moy_nalog_token_url", "https://auth.example.test/token")
    monkeypatch.setattr(settings, "moy_nalog_redirect_uri", "https://app.example.test/callback")
    monkeypatch.setattr(settings, "redis_url", "redis://redis.example.test/0")
    monkeypatch.setattr(settings, "secret_key", _OLD_SHARED)
    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", _KEY_A)
    monkeypatch.setattr(settings, "moy_nalog_token_recovery_retention_days", 7)
    monkeypatch.setattr(settings, "moy_nalog_token_expiring_threshold_sec", 600)
    monkeypatch.setattr(oauth, "_redis", fake)
    monkeypatch.setattr(oauth, "_redis_failed", False)
    return fake


def _tokens(*, refresh: bool = True, expires_in: int = 3600) -> dict:
    return {
        "access_token": "access-secret-value",
        "refresh_token": "refresh-secret-value" if refresh else None,
        "token_type": "Bearer",
        "expires_in": expires_in,
    }


@pytest.mark.asyncio
async def test_dedicated_key_survives_general_signing_secret_rotation(configured_oauth, monkeypatch):
    await oauth.store_tokens("user-a", _tokens())
    stored_before = configured_oauth.values[oauth._token_key("user-a")]
    assert _KEY_A not in stored_before
    assert "access-secret-value" not in stored_before
    assert "refresh-secret-value" not in stored_before

    monkeypatch.setattr(settings, "secret_key", "rotated-general-signing-secret-000000000000000004")
    state = await oauth.connection_state("user-a")

    assert state.active is True
    assert state.status == "active"
    assert state.encryption_key_id == oauth._key_id(_KEY_A)


@pytest.mark.asyncio
async def test_legacy_shared_secret_ciphertext_is_rewrapped_before_signing_key_rotation(
    configured_oauth,
    monkeypatch,
):
    token_key = oauth._token_key("legacy-user")
    legacy_payload = json.dumps(_tokens(), sort_keys=True).encode("utf-8")
    legacy_ciphertext = oauth._encryption_key(_OLD_SHARED).fernet.encrypt(legacy_payload).decode("ascii")
    configured_oauth.setex(token_key, 3000, legacy_ciphertext)

    state = await oauth.connection_state("legacy-user")
    migrated = configured_oauth.values[token_key]

    assert state.active is True
    assert state.legacy_encryption is True
    assert state.encryption_key_id == oauth._key_id(_KEY_A)
    assert migrated != legacy_ciphertext
    envelope = json.loads(migrated)
    assert envelope["version"] == oauth._TOKEN_ENVELOPE_VERSION
    assert envelope["key_id"] == oauth._key_id(_KEY_A)
    assert "access-secret-value" not in migrated
    assert "refresh-secret-value" not in migrated

    monkeypatch.setattr(settings, "secret_key", "rotated-general-signing-secret-000000000000000004")
    after_rotation = await oauth.connection_state("legacy-user")
    assert after_rotation.active is True
    assert after_rotation.encryption_key_id == oauth._key_id(_KEY_A)


@pytest.mark.asyncio
async def test_previous_key_keeps_connection_readable_during_keyring_rotation(configured_oauth, monkeypatch):
    await oauth.store_tokens("user-a", _tokens())
    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", f"{_KEY_B},{_KEY_A}")

    state = await oauth.connection_state("user-a")

    assert state.active is True
    assert state.encryption_key_id == oauth._key_id(_KEY_A)
    health = await oauth.runtime_health()
    assert health["primary_key_id"] == oauth._key_id(_KEY_B)
    assert health["encryption_key_count"] == 2


@pytest.mark.asyncio
async def test_missing_rotation_key_does_not_destroy_recoverable_ciphertext(configured_oauth, monkeypatch):
    await oauth.store_tokens("user-a", _tokens())
    token_key = oauth._token_key("user-a")
    stored_before = configured_oauth.values[token_key]
    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", _KEY_B)

    state = await oauth.connection_state("user-a")

    assert state.active is False
    assert state.status == "encryption_key_unavailable"
    assert configured_oauth.values[token_key] == stored_before


@pytest.mark.asyncio
async def test_refresh_credential_is_retained_locally_but_expired_access_is_never_active(
    configured_oauth,
    monkeypatch,
):
    now = datetime(2026, 8, 23, 12, 0, 0)
    clock = {"now": now}
    monkeypatch.setattr(oauth, "utc_now", lambda: clock["now"])

    access_ttl = await oauth.store_tokens("user-a", _tokens(expires_in=3600))
    token_key = oauth._token_key("user-a")
    assert access_ttl == 3600
    assert configured_oauth.ttls[token_key] == 3600 + 7 * 86400

    clock["now"] = now + timedelta(seconds=3601)
    state = await oauth.connection_state("user-a")

    assert state.active is False
    assert state.status == "expired_refresh_token_retained"
    assert state.refresh_token_retained is True
    assert state.expires_in_seconds == 0
    assert token_key in configured_oauth.values


@pytest.mark.asyncio
async def test_expired_access_without_refresh_token_requires_reconnect_and_is_removed(
    configured_oauth,
    monkeypatch,
):
    now = datetime(2026, 8, 23, 12, 0, 0)
    clock = {"now": now}
    monkeypatch.setattr(oauth, "utc_now", lambda: clock["now"])

    await oauth.store_tokens("user-a", _tokens(refresh=False, expires_in=3600))
    token_key = oauth._token_key("user-a")
    assert configured_oauth.ttls[token_key] == 3600

    clock["now"] = now + timedelta(seconds=3601)
    state = await oauth.connection_state("user-a")

    assert state.active is False
    assert state.status == "reconnect_required"
    assert state.refresh_token_retained is False
    assert token_key not in configured_oauth.values


@pytest.mark.asyncio
async def test_corrupt_record_is_removed_but_fernet_shaped_unknown_key_is_retained(
    configured_oauth,
    monkeypatch,
):
    token_key = oauth._token_key("user-a")
    configured_oauth.setex(token_key, 3600, "not-a-fernet-token")
    corrupt = await oauth.connection_state("user-a")
    assert corrupt.status == "reconnect_required"
    assert token_key not in configured_oauth.values

    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", _KEY_A)
    foreign = oauth._encryption_key(_KEY_B).fernet.encrypt(b"{}").decode("ascii")
    configured_oauth.setex(token_key, 3600, foreign)
    unknown = await oauth.connection_state("user-a")
    assert unknown.status == "encryption_key_unavailable"
    assert configured_oauth.values[token_key] == foreign


def test_working_environment_requires_dedicated_unique_32_byte_keyring(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", "")
    readiness = oauth.oauth_readiness()
    assert "MOY_NALOG_TOKEN_ENCRYPTION_KEYS" in readiness.missing

    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", "short")
    readiness = oauth.oauth_readiness()
    assert "MOY_NALOG_TOKEN_ENCRYPTION_KEYS_MIN_32_BYTES" in readiness.missing

    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", f"{_KEY_A},{_KEY_A}")
    readiness = oauth.oauth_readiness()
    assert "MOY_NALOG_TOKEN_ENCRYPTION_KEYS_UNIQUE" in readiness.missing

    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", f"{_KEY_B},{_KEY_A}")
    assert oauth.oauth_readiness().ready is True


@pytest.mark.asyncio
async def test_runtime_health_is_secret_free_and_does_not_claim_refresh_support(configured_oauth):
    health = await oauth.runtime_health()
    rendered = json.dumps(health, sort_keys=True)

    assert health["healthy"] is True
    assert health["store_reachable"] is True
    assert health["dedicated_encryption_key_configured"] is True
    assert health["primary_key_id"] == oauth._key_id(_KEY_A)
    assert health["automatic_refresh_supported"] is False
    assert _KEY_A not in rendered
    assert _OLD_SHARED not in rendered
    assert "client-secret" not in rendered


def test_preflight_redacts_full_token_encryption_keyring(monkeypatch):
    keyring = f"{_KEY_B},{_KEY_A}"
    monkeypatch.setattr(settings, "moy_nalog_token_encryption_keys", keyring)

    rendered = runtime_preflight._redacted_error(
        RuntimeError(f"provider credential configuration echoed {keyring}")
    )

    assert keyring not in rendered
    assert _KEY_A not in rendered
    assert _KEY_B not in rendered
    assert "<redacted>" in rendered
