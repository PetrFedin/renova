"""OTP send rate-limit + verify lockout (wave-3 audit)."""
import asyncio
import time

from app.services import otp_service as otp


def setup_function():
    otp._store.clear()
    otp._send_log.clear()
    otp._fail_count.clear()
    otp._lock_until.clear()
    otp._RESEND_COOLDOWN = 0  # unit test: only exercise max-sends window


def test_send_rate_limit():
    phone = "+79990001122"

    async def run():
        for _ in range(otp._MAX_SENDS):
            r = await otp.send_otp(phone)
            assert r["ok"] is True
        r = await otp.send_otp(phone)
        assert r["ok"] is False
        assert r.get("rate_limited") is True

    asyncio.run(run())


def test_verify_lockout():
    phone = "+79990003344"

    async def run():
        r = await otp.send_otp(phone)
        assert r["ok"]
        for _ in range(otp._MAX_VERIFY_FAILS):
            assert otp.verify_otp(phone, "0000") is False
        assert otp._lock_until.get(otp._norm(phone), 0) > time.time()
        r2 = await otp.send_otp(phone)
        assert r2["ok"] is False
        assert r2.get("locked") is True

    asyncio.run(run())


def test_resend_cooldown():
    otp._RESEND_COOLDOWN = 60
    phone = "+79990005566"

    async def run():
        r1 = await otp.send_otp(phone)
        assert r1["ok"] is True
        r2 = await otp.send_otp(phone)
        assert r2["ok"] is False
        assert r2.get("rate_limited") is True

    asyncio.run(run())
