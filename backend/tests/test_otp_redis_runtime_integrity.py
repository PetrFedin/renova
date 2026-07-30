from unittest.mock import AsyncMock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.services import otp_service


class FailingRedis:
    def set(self, *_args, **_kwargs):
        raise RedisConnectionError("redis connection lost")

    def get(self, *_args, **_kwargs):
        raise RedisConnectionError("redis connection lost")


@pytest.fixture(autouse=True)
def reset_runtime(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(otp_service.settings, "redis_url", "redis://redis.example.com:6379/0")
    monkeypatch.setattr(otp_service.settings, "secret_key", "test-secret-key-at-least-16")
    otp_service._redis = FailingRedis()
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._send_log.clear()
    otp_service._send_locks.clear()
    yield
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._send_log.clear()
    otp_service._send_locks.clear()


@pytest.mark.asyncio
async def test_runtime_redis_failure_blocks_sms_and_returns_retryable_service_error(monkeypatch):
    sender = AsyncMock()
    monkeypatch.setattr(otp_service, "send_sms", sender)

    result = await otp_service.send_otp("+79991234567")

    assert result == {
        "ok": False,
        "message": "Сервис кодов временно недоступен",
        "service_unavailable": True,
    }
    assert otp_service._redis_failed is True
    assert otp_service._redis is None
    sender.assert_not_awaited()


def test_runtime_redis_failure_during_verify_becomes_typed_store_error():
    with pytest.raises(otp_service.OtpStoreUnavailable, match="redis_unavailable_for_otp"):
        otp_service.verify_otp("+79991234567", "123456")

    assert otp_service._redis_failed is True
    assert otp_service._redis is None
