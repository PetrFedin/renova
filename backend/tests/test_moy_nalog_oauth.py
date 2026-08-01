"""Moy Nalog OAuth state and configuration integrity."""
import pytest

from app.services import moy_nalog_oauth as oauth


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    def set(self, key, value, *, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    def eval(self, _script, _keys_count, key, expected):
        if self.values.get(key) != expected:
            return 0
        del self.values[key]
        return 1


def configure_oauth(monkeypatch) -> FakeRedis:
    settings = oauth.settings
    monkeypatch.setattr(settings, "moy_nalog_enabled", True)
    monkeypatch.setattr(settings, "moy_nalog_client_id", "client-id")
    monkeypatch.setattr(settings, "moy_nalog_client_secret", "client-secret")
    monkeypatch.setattr(settings, "moy_nalog_authorize_url", "https://nalog.test/oauth/authorize")
    monkeypatch.setattr(settings, "moy_nalog_token_url", "https://nalog.test/oauth/token")
    monkeypatch.setattr(settings, "moy_nalog_redirect_uri", "https://renova.test/api/v1/fns/moy-nalog/oauth/callback")
    monkeypatch.setattr(settings, "redis_url", "redis://redis.test/0")
    store = FakeRedis()
    monkeypatch.setattr(oauth, "_redis", store)
    monkeypatch.setattr(oauth, "_redis_failed", False)
    return store


@pytest.mark.asyncio
async def test_state_roundtrip(monkeypatch):
    configure_oauth(monkeypatch)
    state = await oauth.create_oauth_state("user-1")
    assert await oauth.consume_oauth_state(state, "user-1") is True
    assert await oauth.consume_oauth_state(state, "user-1") is False


@pytest.mark.asyncio
async def test_state_wrong_user(monkeypatch):
    configure_oauth(monkeypatch)
    state = await oauth.create_oauth_state("user-1")
    assert await oauth.consume_oauth_state(state, "user-2") is False
    assert await oauth.consume_oauth_state(state, "user-1") is True


def test_build_authorize_url_without_client(monkeypatch):
    monkeypatch.setattr(oauth.settings, "moy_nalog_enabled", False)
    monkeypatch.setattr(oauth.settings, "moy_nalog_client_id", None)
    monkeypatch.setattr(oauth.settings, "moy_nalog_client_secret", None)
    monkeypatch.setattr(oauth.settings, "redis_url", None)
    with pytest.raises(oauth.MoyNalogConfigurationError):
        oauth.build_authorize_url("abc")
    assert oauth.oauth_ready() is False
