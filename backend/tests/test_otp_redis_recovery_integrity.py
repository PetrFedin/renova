from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from redis.exceptions import ConnectionError as RedisConnectionError
from starlette.requests import Request

from app.api.v1 import otp_auth
from app.services import otp_redis_recovery, otp_service


class HealthyRedis:
    def __init__(self, *, ping_delay: float = 0.0):
        self.ping_calls = 0
        self.ping_delay = ping_delay

    def ping(self):
        self.ping_calls += 1
        if self.ping_delay:
            time.sleep(self.ping_delay)
        return True


@pytest.fixture(autouse=True)
def reset_runtime(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(
        otp_service.settings,
        "redis_url",
        "redis://redis.example.com:6379/0",
    )
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_redis_recovery.reset_recovery_state()
    yield
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_redis_recovery.reset_recovery_state()


def test_transient_failure_is_fail_closed_then_recovers_after_backoff(monkeypatch):
    clock = [100.0]
    calls: list[str] = []

    def failing_factory(url, **_kwargs):
        calls.append(url)
        raise RedisConnectionError("temporary outage")

    monkeypatch.setattr(otp_redis_recovery.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr("redis.from_url", failing_factory)

    with pytest.raises(otp_service.OtpStoreUnavailable, match="redis_unavailable_for_otp"):
        otp_redis_recovery.ensure_otp_store_sync()

    first_snapshot = otp_redis_recovery.recovery_snapshot()
    assert first_snapshot == {
        "healthy": False,
        "status": "critical",
        "required": True,
        "configured": True,
        "connected": False,
        "failed": True,
        "failure_count": 1,
        "retry_after_seconds": 1,
    }
    assert len(calls) == 1

    with pytest.raises(otp_service.OtpStoreUnavailable, match="redis_unavailable_for_otp"):
        otp_redis_recovery.ensure_otp_store_sync()
    assert len(calls) == 1, "backoff must prevent a reconnect storm"

    healthy = HealthyRedis()

    def healthy_factory(url, **_kwargs):
        calls.append(url)
        return healthy

    clock[0] = 101.01
    monkeypatch.setattr("redis.from_url", healthy_factory)

    assert otp_redis_recovery.ensure_otp_store_sync() is healthy
    assert healthy.ping_calls == 1
    assert len(calls) == 2
    assert otp_service._redis is healthy
    assert otp_service._redis_failed is False
    assert otp_redis_recovery.recovery_snapshot() == {
        "healthy": True,
        "status": "healthy",
        "required": True,
        "configured": True,
        "connected": True,
        "failed": False,
        "failure_count": 0,
        "retry_after_seconds": 0,
    }


def test_local_preview_without_redis_is_explicitly_not_required(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "development")
    monkeypatch.setattr(otp_service.settings, "redis_url", "")

    assert otp_redis_recovery.recovery_snapshot() == {
        "healthy": True,
        "status": "not_required",
        "required": False,
        "configured": False,
        "connected": False,
        "failed": False,
        "failure_count": 0,
        "retry_after_seconds": 0,
    }


def test_force_probe_ignores_existing_backoff(monkeypatch):
    clock = [200.0]
    monkeypatch.setattr(otp_redis_recovery.time, "monotonic", lambda: clock[0])

    def failing_factory(_url, **_kwargs):
        raise RedisConnectionError("temporary outage")

    monkeypatch.setattr("redis.from_url", failing_factory)
    with pytest.raises(otp_service.OtpStoreUnavailable):
        otp_redis_recovery.ensure_otp_store_sync()

    healthy = HealthyRedis()
    monkeypatch.setattr("redis.from_url", lambda *_args, **_kwargs: healthy)

    assert otp_redis_recovery.ensure_otp_store_sync(force=True) is healthy
    assert healthy.ping_calls == 1
    assert otp_redis_recovery.recovery_snapshot()["failure_count"] == 0


def test_concurrent_recovery_runs_one_connect_and_ping(monkeypatch):
    otp_service._redis_failed = True
    healthy = HealthyRedis(ping_delay=0.03)
    factory_calls = 0
    factory_lock = threading.Lock()
    barrier = threading.Barrier(8)

    def healthy_factory(_url, **_kwargs):
        nonlocal factory_calls
        with factory_lock:
            factory_calls += 1
        return healthy

    def recover():
        barrier.wait()
        return otp_redis_recovery.ensure_otp_store_sync()

    monkeypatch.setattr("redis.from_url", healthy_factory)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _index: recover(), range(8)))

    assert results == [healthy] * 8
    assert factory_calls == 1
    assert healthy.ping_calls == 1
    assert otp_service._redis_failed is False


@pytest.mark.asyncio
async def test_send_endpoint_maps_recovery_failure_to_503_before_sms(monkeypatch):
    async def unavailable(*, force=False):
        raise otp_service.OtpStoreUnavailable("redis_unavailable_for_otp")

    sender = AsyncMock()
    monkeypatch.setattr(otp_redis_recovery, "ensure_otp_store", unavailable)
    monkeypatch.setattr(otp_service, "send_otp", sender)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/sms/send",
            "headers": [],
            "client": ("203.0.113.10", 40000),
            "server": ("testserver", 80),
            "scheme": "http",
            "query_string": b"",
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        await otp_auth.send_code(
            otp_auth.OtpSendIn(phone="+79991234567", device_id="ios-device"),
            request,
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Сервис кодов временно недоступен"
    sender.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_endpoint_maps_abuse_store_race_to_503(monkeypatch):
    async def available(*, force=False):
        return HealthyRedis()

    def failed_guard(*_args, **_kwargs):
        raise otp_service.OtpStoreUnavailable("redis_unavailable_for_otp")

    sender = AsyncMock()
    monkeypatch.setattr(otp_redis_recovery, "ensure_otp_store", available)
    monkeypatch.setattr(otp_auth.otp_abuse_service, "check_and_record", failed_guard)
    monkeypatch.setattr(otp_service, "send_otp", sender)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/sms/send",
            "headers": [],
            "client": ("203.0.113.10", 40000),
            "server": ("testserver", 80),
            "scheme": "http",
            "query_string": b"",
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        await otp_auth.send_code(
            otp_auth.OtpSendIn(phone="+79991234567", device_id="ios-device"),
            request,
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Сервис кодов временно недоступен"
    sender.assert_not_awaited()
