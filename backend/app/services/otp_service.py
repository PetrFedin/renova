"""SMS OTP для входа — demo_code только development/test."""
import random
import time
from app.core.config import settings
from app.services.sms_service import send_sms

_TTL = 300
_store: dict[str, tuple[str, float]] = {}


def _norm(phone: str) -> str:
    return "".join(c for c in phone if c.isdigit())[-10:]


async def send_otp(phone: str) -> dict:
    p = _norm(phone)
    if len(p) < 10:
        return {"ok": False, "message": "Некорректный номер"}
    code = f"{random.randint(100000, 999999)}"
    _store[p] = (code, time.time() + _TTL)
    sms = await send_sms(phone, f"Renova: код входа {code}")
    out = {"ok": True, "message": "Код отправлен"}
    # P0: never return OTP in staging/production responses
    if settings.normalized_environment in ("development", "test"):
        out["demo_code"] = code
        if sms.get("demo"):
            out["demo"] = True
    return out


def verify_otp(phone: str, code: str) -> bool:
    p = _norm(phone)
    rec = _store.get(p)
    if not rec:
        return False
    stored, exp = rec
    if time.time() > exp:
        _store.pop(p, None)
        return False
    if stored != code.strip():
        return False
    _store.pop(p, None)
    return True
