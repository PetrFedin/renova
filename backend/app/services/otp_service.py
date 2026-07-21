"""SMS OTP для входа — demo_code только development/test; rate-limit + anti-bruteforce."""
from __future__ import annotations

import random
import time
from collections import defaultdict

from app.core.config import settings
from app.services.sms_service import send_sms

_TTL = 300
_SEND_WINDOW = 600  # 10 min
_MAX_SENDS = 5
_MAX_VERIFY_FAILS = 5
_LOCK_SECONDS = 900  # 15 min after too many fails

_store: dict[str, tuple[str, float]] = {}
_send_log: dict[str, list[float]] = defaultdict(list)
_fail_count: dict[str, int] = defaultdict(int)
_lock_until: dict[str, float] = {}


def _norm(phone: str) -> str:
    return "".join(c for c in phone if c.isdigit())[-10:]


def _prune_sends(p: str, now: float) -> None:
    _send_log[p] = [t for t in _send_log[p] if now - t < _SEND_WINDOW]


async def send_otp(phone: str) -> dict:
    p = _norm(phone)
    if len(p) < 10:
        return {"ok": False, "message": "Некорректный номер"}
    now = time.time()
    if _lock_until.get(p, 0) > now:
        left = int(_lock_until[p] - now)
        return {"ok": False, "message": f"Слишком много попыток. Повторите через {left // 60 + 1} мин", "locked": True}
    _prune_sends(p, now)
    if len(_send_log[p]) >= _MAX_SENDS:
        return {"ok": False, "message": "Лимит SMS исчерпан. Подождите 10 минут", "rate_limited": True}

    code = f"{random.randint(100000, 999999)}"
    _store[p] = (code, now + _TTL)
    _send_log[p].append(now)
    sms = await send_sms(phone, f"Renova: код входа {code}")
    out: dict = {"ok": True, "message": "Код отправлен"}
    # P0: never return OTP in staging/production responses
    if settings.normalized_environment in ("development", "test"):
        out["demo_code"] = code
        if sms.get("demo"):
            out["demo"] = True
    return out


def verify_otp(phone: str, code: str) -> bool:
    p = _norm(phone)
    now = time.time()
    if _lock_until.get(p, 0) > now:
        return False
    rec = _store.get(p)
    if not rec:
        _fail_count[p] += 1
        if _fail_count[p] >= _MAX_VERIFY_FAILS:
            _lock_until[p] = now + _LOCK_SECONDS
            _fail_count[p] = 0
        return False
    stored, exp = rec
    if now > exp:
        _store.pop(p, None)
        return False
    if stored != code.strip():
        _fail_count[p] += 1
        if _fail_count[p] >= _MAX_VERIFY_FAILS:
            _lock_until[p] = now + _LOCK_SECONDS
            _fail_count[p] = 0
            _store.pop(p, None)
        return False
    _store.pop(p, None)
    _fail_count.pop(p, None)
    _lock_until.pop(p, None)
    return True
