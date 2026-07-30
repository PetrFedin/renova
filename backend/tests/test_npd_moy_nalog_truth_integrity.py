from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.core.config import settings
from app.services import moy_nalog_oauth as oauth
from app.services.fns import status_npd


class FakeResponse:
    def __init__(self, status_code: int, payload=None, *, json_error: Exception | None = None):
        self.status_code = status_code
        self._payload = payload
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise self._json_error
        return self._payload


class FakeAsyncClient:
    response = FakeResponse(200, {"status": False, "message": "not npd"})
    error: Exception | None = None
    timeout = None
    posted_url = None
    posted_json = None

    def __init__(self, *, timeout):
        type(self).timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, json=None, data=None):
        type(self).posted_url = url
        type(self).posted_json = json if json is not None else data
        if type(self).error:
            raise type(self).error
        return type(self).response


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
def reset_integrations(monkeypatch):
    FakeAsyncClient.response = FakeResponse(200, {"status": False, "message": "not npd"})
    FakeAsyncClient.error = None
    monkeypatch.setattr(status_npd.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(settings, "fns_npd_status_url", "https://statusnpd.example.test/api")

    fake_redis = FakeRedis()
    monkeypatch.setattr(settings, "moy_nalog_enabled", True)
    monkeypatch.setattr(settings, "moy_nalog_client_id", "client-id")
    monkeypatch.setattr(settings, "moy_nalog_client_secret", "client-secret")
    monkeypatch.setattr(settings, "moy_nalog_authorize_url", "https://auth.example.test/oauth")
    monkeypatch.setattr(settings, "moy_nalog_token_url", "https://auth.example.test/token")
    monkeypatch.setattr(settings, "moy_nalog_redirect_uri", "https://app.example.test/callback")
    monkeypatch.setattr(settings, "redis_url", "redis://redis.example.test/0")
    monkeypatch.setattr(settings, "secret_key", "test-secret-key-long-enough")
    monkeypatch.setattr(oauth, "_redis", fake_redis)
    monkeypatch.setattr(oauth, "_redis_failed", False)
    yield fake_redis


def test_inn_and_date_validation_are_local_and_deterministic():
    assert status_npd.normalize_inn(" 525741209968 ") == "525741209968"
    with pytest.raises(status_npd.FnsNpdInvalidRequest):
        status_npd.normalize_inn("52574120996x")
    with pytest.raises(status_npd.FnsNpdInvalidRequest):
        status_npd.normalize_request_date(date(2018, 12, 31))
    with pytest.raises(status_npd.FnsNpdInvalidRequest):
        status_npd.normalize_request_date(date.today().replace(year=date.today().year + 1))


@pytest.mark.asyncio
async def test_boolean_false_remains_false_and_official_timeout_is_used():
    result = await status_npd.check_taxpayer_npd_status("525741209968", date(2026, 7, 30))
    assert result["is_npd"] is False
    assert result["verified_live"] is True
    assert FakeAsyncClient.timeout >= 60
    assert FakeAsyncClient.posted_json == {"inn": "525741209968", "requestDate": "2026-07-30"}


@pytest.mark.asyncio
async def test_string_false_and_malformed_json_never_become_verified():
    FakeAsyncClient.response = FakeResponse(200, {"status": "false", "message": "not npd"})
    with pytest.raises(status_npd.FnsNpdProtocolError):
        await status_npd.check_taxpayer_npd_status("525741209968", date(2026, 7, 30))

    FakeAsyncClient.response = FakeResponse(200, json_error=ValueError("bad json"))
    with pytest.raises(status_npd.FnsNpdProtocolError):
        await status_npd.check_taxpayer_npd_status("525741209968", date(2026, 7, 30))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_code", "error_type"),
    [
        ("validation.failed", status_npd.FnsNpdInvalidRequest),
        ("taxpayer.status.service.limited.error", status_npd.FnsNpdRateLimited),
        ("taxpayer.status.service.unavailable.error", status_npd.FnsNpdUnavailable),
        ("unknown.error", status_npd.FnsNpdProtocolError),
    ],
)
async def test_official_422_business_codes_are_not_collapsed(provider_code, error_type):
    FakeAsyncClient.response = FakeResponse(422, {"code": provider_code, "message": "provider message"})
    with pytest.raises(error_type):
        await status_npd.check_taxpayer_npd_status("525741209968", date(2026, 7, 30))


@pytest.mark.asyncio
async def test_timeout_is_retryable_unavailable():
    FakeAsyncClient.error = httpx.TimeoutException("timeout")
    with pytest.raises(status_npd.FnsNpdUnavailable) as caught:
        await status_npd.check_taxpayer_npd_status("525741209968", date(2026, 7, 30))
    assert caught.value.retryable is True
    assert caught.value.http_status == 503


def test_oauth_readiness_requires_full_https_and_redis(monkeypatch):
    assert oauth.oauth_readiness().ready is True
    monkeypatch.setattr(settings, "moy_nalog_token_url", None)
    readiness = oauth.oauth_readiness()
    assert readiness.ready is False
    assert "MOY_NALOG_TOKEN_URL_HTTPS" in readiness.missing


@pytest.mark.asyncio
async def test_oauth_state_is_shared_one_time_and_user_bound(reset_integrations):
    state = await oauth.create_oauth_state("user-a")
    assert state not in json.dumps(reset_integrations.values)
    assert await oauth.consume_oauth_state(state, "user-b") is False
    assert await oauth.consume_oauth_state(state, "user-a") is True
    assert await oauth.consume_oauth_state(state, "user-a") is False


@pytest.mark.asyncio
async def test_tokens_are_encrypted_ttl_bound_and_revocable(reset_integrations):
    tokens = {
        "access_token": "access-secret-value",
        "refresh_token": "refresh-secret-value",
        "token_type": "Bearer",
        "expires_in": 3600,
    }
    ttl = await oauth.store_tokens("user-a", tokens)
    assert ttl == 3600
    key = oauth._token_key("user-a")
    stored = reset_integrations.values[key]
    assert "access-secret-value" not in stored
    assert "refresh-secret-value" not in stored
    assert reset_integrations.ttls[key] == 3600
    assert await oauth.connection_active("user-a") is True
    await oauth.revoke_tokens("user-a")
    assert key not in reset_integrations.values


@pytest.mark.asyncio
async def test_corrupt_token_ciphertext_is_removed(reset_integrations):
    key = oauth._token_key("user-a")
    reset_integrations.setex(key, 3600, "not-a-fernet-token")
    assert await oauth.connection_active("user-a") is False
    assert key not in reset_integrations.values


def test_token_payload_requires_bearer_and_bounded_expiry():
    with pytest.raises(oauth.MoyNalogProviderError):
        oauth._validate_token_payload({"access_token": "x", "expires_in": "3600"})
    with pytest.raises(oauth.MoyNalogProviderError):
        oauth._validate_token_payload({"access_token": "x", "token_type": "MAC", "expires_in": 3600})
    assert oauth._validate_token_payload({"access_token": "x", "expires_in": 3600})["token_type"] == "Bearer"


def test_api_source_forbids_fake_linked_and_demo_transitions():
    source = (Path(__file__).parents[1] / "app" / "api" / "v1" / "fns.py").read_text(encoding="utf-8")
    legacy = source[source.index('async def link_moy_nalog'):source.index('@router.post("/moy-nalog/unlink"')]
    callback = source[source.index('async def moy_nalog_oauth_callback'):]
    assert "moy_nalog_legacy_link_removed" in legacy
    assert "moy_nalog_linked = True" not in legacy
    assert "moy_nalog_demo_disabled" in callback
    assert callback.index("await oauth.store_tokens") < callback.index("moy_nalog_linked = True")
    assert callback.index("await oauth.connection_active") < callback.index("moy_nalog_linked = True")
