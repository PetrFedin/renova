"""OTP still works without Redis (memory fallback)."""
import asyncio
from app.services import otp_service as otp


def setup_function():
    otp._store.clear()
    otp._send_log.clear()
    otp._fail_count.clear()
    otp._lock_until.clear()
    otp._redis = None
    otp._redis_failed = False
    otp._RESEND_COOLDOWN = 0


def test_memory_send_verify():
    async def run():
        r = await otp.send_otp("+79990007788")
        assert r["ok"] is True
        code = r.get("demo_code")
        assert code
        assert otp.verify_otp("+79990007788", code) is True

    asyncio.run(run())
