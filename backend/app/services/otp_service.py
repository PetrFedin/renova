"""SMS OTP для входа — dev: код в ответе API; prod: Twilio."""
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
    if sms.get("demo") or getattr(settings, "debug", True):
        out["demo_code"] = code
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
