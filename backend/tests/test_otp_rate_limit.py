"""OTP send rate-limit + verify lockout (wave-3 audit)."""
import asyncio
import time

import pytest

from app.services import otp_service as otp


@pytest.fixture(autouse=True)
def reset_otp_state():
    """Isolate local OTP state and restore the production cooldown explicitly."""
    original_cooldown = otp._RESEND_COOLDOWN
    otp._RESEND_COOLDOWN = 0
    otp._store.clear()
    otp._send_log.clear()
    otp._fail_count.clear()
    otp._lock_until.clear()
    otp._send_locks.clear()
    try:
        yield
    finally:
        otp._RESEND_COOLDOWN = original_cooldown
        otp._store.clear()
        otp._send_log.clear()
        otp._fail_count.clear()
        otp._lock_until.clear()
        otp._send_locks.clear()


def test_send_rate_limit():
    phone = "+79990001122"

    async def run():
        for _ in range(otp._MAX_SENDS):
            result = await otp.send_otp(phone)
            assert result["ok"] is True
        result = await otp.send_otp(phone)
        assert result["ok"] is False
        assert result.get("rate_limited") is True

    asyncio.run(run())


def test_verify_lockout():
    phone = "+79990003344"

    async def run():
        result = await otp.send_otp(phone)
        assert result["ok"]
        for _ in range(otp._MAX_VERIFY_FAILS):
            assert otp.verify_otp(phone, "0000") is False
        assert otp._lock_until.get(otp._norm(phone), 0) > time.time()
        locked = await otp.send_otp(phone)
        assert locked["ok"] is False
        assert locked.get("locked") is True

    asyncio.run(run())


def test_resend_cooldown():
    otp._RESEND_COOLDOWN = 60
    phone = "+79990005566"

    async def run():
        first = await otp.send_otp(phone)
        assert first["ok"] is True
        second = await otp.send_otp(phone)
        assert second["ok"] is False
        assert second.get("rate_limited") is True

    asyncio.run(run())
