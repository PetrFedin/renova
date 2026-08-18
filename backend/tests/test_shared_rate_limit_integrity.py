from __future__ import annotations

import asyncio
import os

import httpx
import pytest
from redis.asyncio import Redis
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.config import settings
from app.core.rate_limit import (
    RateLimitBackendUnavailable,
    RateLimitDecision,
    SharedRateLimiter,
    rate_limit_storage_key,
)
from app.middleware.rate_limit import RateLimitMiddleware


async def _ok(_request):
    return JSONResponse({"ok": True})


def _app(limiter, *, window_seconds: float = 60) -> Starlette:
    app = Starlette(routes=[Route("/api/v1/ping", _ok)])
    app.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        window_seconds=window_seconds,
    )
    return app


@pytest.fixture
async def redis_pair():
    url = os.getenv("RATE_LIMIT_TEST_REDIS_URL")
    if not url:
        pytest.skip("RATE_LIMIT_TEST_REDIS_URL is required for shared Redis integration tests")

    clients = [
        Redis.from_url(url, decode_responses=True),
        Redis.from_url(url, decode_responses=True),
    ]
    await clients[0].ping()
    await clients[0].flushdb()
    try:
        yield clients
    finally:
        await clients[0].flushdb()
        for client in clients:
            await client.aclose()


def test_rate_limit_storage_key_does_not_disclose_identity():
    identity = "user:customer@example.com"
    key = rate_limit_storage_key("public-api", identity)

    assert identity not in key
    assert "customer@example.com" not in key
    assert key == rate_limit_storage_key("public-api", identity)
    assert key != rate_limit_storage_key("public-api", "user:other@example.com")


@pytest.mark.asyncio
async def test_two_app_instances_share_quota_retry_after_and_window_expiry(
    monkeypatch,
    redis_pair,
):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "rate_limit_rpm", 2)

    limiter_a = SharedRateLimiter(redis_pair[0])
    limiter_b = SharedRateLimiter(redis_pair[1])
    app_a = _app(limiter_a, window_seconds=0.2)
    app_b = _app(limiter_b, window_seconds=0.2)

    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app_a),
            base_url="http://replica-a",
        ) as client_a,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app_b),
            base_url="http://replica-b",
        ) as client_b,
    ):
        first = await client_a.get("/api/v1/ping")
        second = await client_b.get("/api/v1/ping")
        blocked = await client_a.get("/api/v1/ping")

        assert first.status_code == 200
        assert second.status_code == 200
        assert blocked.status_code == 429
        assert blocked.json() == {"detail": "rate_limit"}
        assert int(blocked.headers["Retry-After"]) >= 1

        await asyncio.sleep(0.3)
        reset = await client_b.get("/api/v1/ping")
        assert reset.status_code == 200


@pytest.mark.asyncio
async def test_atomic_shared_quota_cannot_be_oversubscribed(redis_pair):
    limiters = [SharedRateLimiter(redis_pair[0]), SharedRateLimiter(redis_pair[1])]

    async def attempt(index: int):
        return await limiters[index % 2].check(
            "concurrency",
            "user:shared",
            limit=5,
            window_seconds=5,
        )

    decisions = await asyncio.gather(*(attempt(index) for index in range(20)))
    assert sum(decision.allowed for decision in decisions) == 5
    assert all(decision.remaining >= 0 for decision in decisions)


class _FailingRedis:
    async def eval(self, *_args, **_kwargs):
        raise ConnectionError("redis down")

    async def ping(self):
        raise ConnectionError("redis down")


@pytest.mark.asyncio
async def test_test_environment_falls_back_to_deterministic_local_quota(monkeypatch):
    monkeypatch.setattr(settings, "environment", "test")
    limiter = SharedRateLimiter(_FailingRedis())

    first = await limiter.check("local", "user:one", limit=2, window_seconds=5)
    second = await limiter.check("local", "user:one", limit=2, window_seconds=5)
    blocked = await limiter.check("local", "user:one", limit=2, window_seconds=5)

    assert first.allowed is True
    assert second.allowed is True
    assert blocked.allowed is False
    assert blocked.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_deployed_environment_fails_closed_when_redis_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    limiter = SharedRateLimiter(_FailingRedis())

    with pytest.raises(RateLimitBackendUnavailable):
        await limiter.check("public-api", "user:one", limit=2)

    with pytest.raises(RateLimitBackendUnavailable):
        await limiter.ping()


class _BlockedLimiter:
    async def check(self, *_args, **_kwargs):
        return RateLimitDecision(allowed=False, remaining=0, retry_after_seconds=17)


class _UnavailableLimiter:
    async def check(self, *_args, **_kwargs):
        raise RateLimitBackendUnavailable("redis down")


@pytest.mark.asyncio
async def test_middleware_propagates_shared_window_retry_after(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    app = _app(_BlockedLimiter())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/ping")

    assert response.status_code == 429
    assert response.json() == {"detail": "rate_limit"}
    assert response.headers["Retry-After"] == "17"


@pytest.mark.asyncio
async def test_middleware_returns_503_when_shared_backend_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    app = _app(_UnavailableLimiter())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/ping")

    assert response.status_code == 503
    assert response.json() == {"detail": "rate_limit_backend_unavailable"}
    assert response.headers["Retry-After"] == "1"
