import json

import pytest

from app import main
from app.core.observability import release_digest


class _Session:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.executed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.executed = True
        if self.fail:
            raise RuntimeError("database unavailable")
        assert str(statement) == "SELECT 1"


class _RateLimiter:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.pinged = False

    async def ping(self):
        self.pinged = True
        if self.fail:
            raise RuntimeError("redis unavailable")


@pytest.mark.asyncio
async def test_health_exposes_build_release_without_claiming_dependency_readiness(monkeypatch):
    monkeypatch.setenv("RENOVA_GIT_SHA", "abc123")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:" + "a" * 64)

    payload = await main.health()

    assert payload["status"] == "ok"
    assert payload["service"] == "renova-api"
    assert payload["release"] == "abc123"
    assert payload["artifact_digest"] == "sha256:" + "a" * 64


@pytest.mark.asyncio
async def test_readiness_requires_database_and_shared_rate_limit_backend(monkeypatch):
    session = _Session()
    limiter = _RateLimiter()
    monkeypatch.setenv("RENOVA_GIT_SHA", "release-sha")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:" + "b" * 64)
    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(main, "rate_limiter", limiter)

    payload = await main.readiness()

    assert session.executed is True
    assert limiter.pinged is True
    assert payload == {
        "status": "ready",
        "service": "renova-api",
        "release": "release-sha",
        "artifact_digest": "sha256:" + "b" * 64,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["database", "redis"])
async def test_readiness_fails_closed_without_leaking_provider_errors(monkeypatch, failure):
    session = _Session(fail=failure == "database")
    limiter = _RateLimiter(fail=failure == "redis")
    monkeypatch.setenv("RENOVA_GIT_SHA", "release-sha")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:" + "c" * 64)
    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(main, "rate_limiter", limiter)

    response = await main.readiness()

    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload == {
        "status": "not_ready",
        "service": "renova-api",
        "release": "release-sha",
        "artifact_digest": "sha256:" + "c" * 64,
    }
    assert failure not in response.body.decode("utf-8")


def test_missing_artifact_digest_is_explicitly_unknown(monkeypatch):
    monkeypatch.delenv("RENOVA_IMAGE_DIGEST", raising=False)
    assert release_digest() == "unknown"
