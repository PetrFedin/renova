import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1 import auth
from app.core import environment
from app.core.phone import InvalidPhoneNumber, normalize_phone
from app.schemas.auth import RegisterRequest, SmsSendRequest, SmsVerifyRequest
from app.services import otp_runtime, otp_service, sms_service


@pytest.fixture(autouse=True)
def reset_sms_otp_state(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "test")
    monkeypatch.setattr(otp_service.settings, "redis_url", None)
    monkeypatch.setattr(otp_service.settings, "secret_key", "test-secret-key-at-least-16")
    monkeypatch.setattr(otp_service.settings, "twilio_sid", None)
    monkeypatch.setattr(otp_service.settings, "twilio_token", None)
    monkeypatch.setattr(otp_service.settings, "twilio_from", None)

    otp_service._store.clear()
    otp_service._send_log.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._send_locks.clear()
    otp_service._redis = None
    otp_service._redis_failed = False
    yield
    otp_service._store.clear()
    otp_service._send_log.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._send_locks.clear()
    otp_service._redis = None
    otp_service._redis_failed = False


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("89991234567", "+79991234567"),
        ("7 (999) 123-45-67", "+79991234567"),
        ("999 123 45 67", "+79991234567"),
        ("+31 20 123 4567", "+31201234567"),
    ],
)
def test_phone_identity_is_canonical(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["", "123", "+7\n9991234567", "9991234567 ext 2", "++79991234567", "00123456789"],
)
def test_ambiguous_or_unsafe_phone_is_rejected(raw):
    with pytest.raises(InvalidPhoneNumber):
        normalize_phone(raw)


def test_auth_schemas_canonicalize_same_phone_to_one_identity():
    send = SmsSendRequest(phone="8 (999) 123-45-67")
    verify = SmsVerifyRequest(phone="79991234567", code="123456", role="customer")
    register = RegisterRequest(phone="9991234567", role="customer")

    assert send.phone == verify.phone == register.phone == "+79991234567"

    with pytest.raises(ValidationError):
        SmsSendRequest(phone="invalid phone")


@pytest.mark.asyncio
async def test_local_missing_twilio_is_preview_not_delivery():
    result = await sms_service.send_sms("89991234567", "Renova: код входа 123456")

    assert result == sms_service.SmsDeliveryResult(delivered=False, preview=True)


@pytest.mark.asyncio
async def test_working_environment_never_returns_demo_sms_success(monkeypatch):
    monkeypatch.setattr(sms_service.settings, "environment", "production")

    with pytest.raises(sms_service.SmsConfigurationError, match="twilio_not_configured"):
        await sms_service.send_sms("+79991234567", "Renova: код входа 123456")


@pytest.mark.asyncio
async def test_partial_twilio_configuration_fails_closed(monkeypatch):
    monkeypatch.setattr(sms_service.settings, "twilio_sid", "synthetic-account")

    with pytest.raises(sms_service.SmsConfigurationError, match="partial_twilio_configuration"):
        await sms_service.send_sms("+79991234567", "Renova: код входа 123456")


class FakeResponse:
    def __init__(self, payload, status_code=201):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://api.twilio.com")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("failed", request=request, response=response)

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, *, auth, data):
        self.calls.append({"url": url, "auth": auth, "data": data})
        return self.response


def configure_twilio(monkeypatch):
    monkeypatch.setattr(sms_service.settings, "twilio_sid", "synthetic-account")
    monkeypatch.setattr(sms_service.settings, "twilio_token", "synthetic-token")
    monkeypatch.setattr(sms_service.settings, "twilio_from", "8 (495) 123-45-67")


@pytest.mark.asyncio
async def test_twilio_success_requires_message_sid_and_uses_canonical_numbers(monkeypatch):
    configure_twilio(monkeypatch)
    client = FakeAsyncClient(FakeResponse({"sid": "SM-test-message", "error_code": None}))
    monkeypatch.setattr(sms_service.httpx, "AsyncClient", lambda **_kwargs: client)

    result = await sms_service.send_sms("8 (999) 123-45-67", "Renova: код входа 123456")

    assert result.delivered is True
    assert result.preview is False
    assert result.provider_id == "SM-test-message"
    assert client.calls[0]["data"]["To"] == "+79991234567"
    assert client.calls[0]["data"]["From"] == "+74951234567"
    assert client.calls[0]["auth"] == ("synthetic-account", "synthetic-token")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        FakeResponse({"status": "queued"}),
        FakeResponse({"sid": "SM-test", "error_code": 30007}),
        FakeResponse({"message": "provider down"}, status_code=503),
        FakeResponse(ValueError("invalid json")),
    ],
)
async def test_twilio_invalid_or_rejected_response_fails_closed(monkeypatch, response):
    configure_twilio(monkeypatch)
    monkeypatch.setattr(
        sms_service.httpx,
        "AsyncClient",
        lambda **_kwargs: FakeAsyncClient(response),
    )

    with pytest.raises(sms_service.SmsDeliveryFailed):
        await sms_service.send_sms("+79991234567", "Renova: код входа 123456")


@pytest.mark.asyncio
async def test_preview_otp_is_hashed_single_use_and_not_plaintext(monkeypatch):
    monkeypatch.setattr(otp_service.secrets, "randbelow", lambda _limit: 123456)

    result = await otp_service.send_otp("8 (999) 123-45-67")

    assert result == {
        "ok": True,
        "message": "Код отправлен",
        "preview": True,
        "demo_code": "123456",
    }
    stored_digest, expires_at = otp_service._store["+79991234567"]
    assert stored_digest != "123456"
    assert len(stored_digest) == 64
    assert expires_at > time.time()
    assert otp_service.verify_otp("79991234567", "123456") is True
    assert otp_service.verify_otp("+79991234567", "123456") is False


@pytest.mark.asyncio
async def test_delivery_failure_restores_previous_code_and_rate_limit(monkeypatch):
    phone = "+79991234567"
    previous_code = "111111"
    previous_digest = otp_service._digest(phone, previous_code)
    otp_service._store_code(phone, previous_digest, time.time() + 240)
    monkeypatch.setattr(otp_service.secrets, "randbelow", lambda _limit: 222222)
    monkeypatch.setattr(
        otp_service,
        "send_sms",
        AsyncMock(side_effect=sms_service.SmsDeliveryFailed("twilio_delivery_failed")),
    )

    result = await otp_service.send_otp(phone)

    assert result["ok"] is False
    assert result["service_unavailable"] is True
    assert otp_service._send_log[phone] == []
    assert otp_service.verify_otp(phone, "222222") is False
    assert otp_service.verify_otp(phone, previous_code) is True


@pytest.mark.asyncio
async def test_concurrent_double_tap_sends_only_one_sms(monkeypatch):
    calls = 0

    async def preview_sender(_phone, _text):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return sms_service.SmsDeliveryResult(delivered=False, preview=True)

    monkeypatch.setattr(otp_service, "send_sms", preview_sender)

    first, second = await asyncio.gather(
        otp_service.send_otp("+79991234567"),
        otp_service.send_otp("8 999 123 45 67"),
    )

    assert calls == 1
    assert sorted([first["ok"], second["ok"]]) == [False, True]
    rejected = first if not first["ok"] else second
    assert rejected["rate_limited"] is True


@pytest.mark.asyncio
async def test_working_environment_requires_shared_redis_before_sms(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(otp_service.settings, "redis_url", None)
    sender = AsyncMock()
    monkeypatch.setattr(otp_service, "send_sms", sender)

    result = await otp_service.send_otp("+79991234567")

    assert result["ok"] is False
    assert result["service_unavailable"] is True
    sender.assert_not_awaited()
    with pytest.raises(otp_service.OtpStoreUnavailable, match="redis_required_for_otp"):
        otp_service.verify_otp("+79991234567", "123456")


@pytest.mark.asyncio
async def test_startup_otp_runtime_fails_when_redis_is_unreachable(monkeypatch):
    monkeypatch.setattr(otp_runtime.settings, "environment", "production")
    monkeypatch.setattr(
        otp_service,
        "_redis_client",
        lambda: (_ for _ in ()).throw(otp_service.OtpStoreUnavailable("redis_unavailable_for_otp")),
    )

    with pytest.raises(otp_service.OtpStoreUnavailable):
        await otp_runtime.validate_otp_runtime()


def complete_production_settings(**overrides):
    values = {
        "environment": "production",
        "database_url": "postgresql+asyncpg://renova:secret@db/renova",
        "public_base_url": "https://api.renova.example",
        "secret_key": "production-secret-key-at-least-32",
        "redis_url": "rediss://redis.example.com:6379/0",
        "twilio_sid": "synthetic-account-id-for-tests",
        "twilio_token": "synthetic-provider-token-for-tests",
        "twilio_from": "+74951234567",
    }
    values.update(overrides)
    return values


def test_working_environment_requires_complete_redis_and_twilio_configuration():
    with pytest.raises(ValueError, match="REDIS_URL обязателен"):
        environment.validate_runtime_settings(
            **complete_production_settings(redis_url=None)
        )
    with pytest.raises(ValueError, match="полная Twilio-конфигурация обязательна"):
        environment.validate_runtime_settings(
            **complete_production_settings(
                twilio_sid=None,
                twilio_token=None,
                twilio_from=None,
            )
        )
    with pytest.raises(ValueError, match="должны быть заданы вместе"):
        environment.validate_runtime_settings(
            **complete_production_settings(twilio_token=None)
        )
    with pytest.raises(ValueError, match="REDIS_URL должен начинаться"):
        environment.validate_runtime_settings(
            **complete_production_settings(redis_url="https://redis.example.com")
        )

    policy = environment.validate_runtime_settings(**complete_production_settings())
    assert policy.name == "production"


def test_development_warnings_disclose_preview_and_process_memory():
    warnings = environment.collect_warnings(
        environment="development",
        database_url="sqlite+aiosqlite:///./renova.db",
        secret_key="dev-secret-change-me",
    )

    assert any("OTP uses process memory" in warning for warning in warnings)
    assert any("OTP SMS is preview only" in warning for warning in warnings)


def test_production_demo_endpoint_cannot_be_enabled_by_override(monkeypatch):
    monkeypatch.setattr(auth.settings, "environment", "production")
    monkeypatch.setattr(auth.settings, "allow_demo_seed", True)

    assert auth._demo_endpoints_allowed() is False


@pytest.mark.asyncio
async def test_sms_send_maps_provider_or_store_failure_to_503(monkeypatch):
    monkeypatch.setattr(
        otp_service,
        "send_otp",
        AsyncMock(
            return_value={
                "ok": False,
                "service_unavailable": True,
                "message": "SMS временно недоступна",
            }
        ),
    )

    with pytest.raises(HTTPException) as error:
        await auth.sms_send(SmsSendRequest(phone="+79991234567"))

    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_sms_verify_maps_shared_store_failure_to_503(monkeypatch):
    monkeypatch.setattr(
        otp_service,
        "verify_otp",
        lambda *_args: (_ for _ in ()).throw(
            otp_service.OtpStoreUnavailable("redis_unavailable_for_otp")
        ),
    )

    with pytest.raises(HTTPException) as error:
        await auth.sms_verify(
            SmsVerifyRequest(
                phone="+79991234567",
                code="123456",
                role="customer",
            ),
            db=SimpleNamespace(),
        )

    assert error.value.status_code == 503


def test_main_wires_otp_dependencies_into_startup_guard():
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "main.py").read_text(encoding="utf-8")
    pyproject = (backend / "pyproject.toml").read_text(encoding="utf-8")

    assert "redis_url=settings.redis_url" in source
    assert "twilio_sid=settings.twilio_sid" in source
    assert "await validate_otp_runtime()" in source
    assert 'redis = "^5.2.0"' in pyproject
    assert "optional = true" not in pyproject
