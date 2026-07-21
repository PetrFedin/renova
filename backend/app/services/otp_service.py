"""SMS OTP — Redis when REDIS_URL set, else in-process (P1.9)."""
from __future__ import annotations

import logging
import secrets
import time
from collections import defaultdict

from app.core.config import settings
from app.services.sms_service import send_sms

logger = logging.getLogger("renova.otp")

_TTL = 300
_SEND_WINDOW = 600
_MAX_SENDS = 5
_RESEND_COOLDOWN = 60
_MAX_VERIFY_FAILS = 5
_LOCK_SECONDS = 900

_store: dict[str, tuple[str, float]] = {}
_send_log: dict[str, list[float]] = defaultdict(list)
_fail_count: dict[str, int] = defaultdict(int)
_lock_until: dict[str, float] = {}

_redis = None
_redis_failed = False


def _norm(phone: str) -> str:
    return "".join(c for c in phone if c.isdigit())[-10:]


def _redis_client():
    global _redis, _redis_failed
    url = (settings.redis_url or "").strip()
    if not url or _redis_failed:
        return None
    if _redis is not None:
        return _redis
    try:
        import redis  # sync client — OTP is sync verify / short ops

        _redis = redis.from_url(url, decode_responses=True, socket_connect_timeout=1.5)
        _redis.ping()
        logger.info("otp store: redis")
        return _redis
    except Exception:
        _redis_failed = True
        logger.warning("otp store: redis unavailable — falling back to memory", exc_info=True)
        return None


def _rk(kind: str, p: str) -> str:
    return f"renova:otp:{kind}:{p}"


def _prune_sends(p: str, now: float) -> None:
    r = _redis_client()
    if r:
        key = _rk("sends", p)
        # keep list in redis as comma timestamps — simpler: use sorted set
        r.zremrangebyscore(key, 0, now - _SEND_WINDOW)
        return
    _send_log[p] = [t for t in _send_log[p] if now - t < _SEND_WINDOW]


def _send_count(p: str, now: float) -> int:
    r = _redis_client()
    if r:
        key = _rk("sends", p)
        r.zremrangebyscore(key, 0, now - _SEND_WINDOW)
        return int(r.zcard(key))
    return len(_send_log[p])


def _last_send(p: str) -> float:
    r = _redis_client()
    if r:
        key = _rk("sends", p)
        rows = r.zrevrange(key, 0, 0, withscores=True)
        return float(rows[0][1]) if rows else 0.0
    return _send_log[p][-1] if _send_log[p] else 0.0


def _record_send(p: str, now: float) -> None:
    r = _redis_client()
    if r:
        key = _rk("sends", p)
        r.zadd(key, {str(now): now})
        r.expire(key, _SEND_WINDOW + 60)
        return
    _send_log[p].append(now)


def _lock_left(p: str, now: float) -> int:
    r = _redis_client()
    if r:
        raw = r.get(_rk("lock", p))
        if not raw:
            return 0
        exp = float(raw)
        return max(0, int(exp - now))
    return max(0, int(_lock_until.get(p, 0) - now))


def _set_lock(p: str, until: float) -> None:
    r = _redis_client()
    if r:
        ttl = max(1, int(until - time.time()))
        r.setex(_rk("lock", p), ttl, str(until))
        return
    _lock_until[p] = until


def _store_code(p: str, code: str, exp: float) -> None:
    r = _redis_client()
    if r:
        r.setex(_rk("code", p), _TTL, code)
        return
    _store[p] = (code, exp)


def _get_code(p: str) -> tuple[str, float] | None:
    r = _redis_client()
    if r:
        code = r.get(_rk("code", p))
        if not code:
            return None
        ttl = r.ttl(_rk("code", p))
        exp = time.time() + (ttl if ttl and ttl > 0 else 0)
        return code, exp
    return _store.get(p)


def _clear_code(p: str) -> None:
    r = _redis_client()
    if r:
        r.delete(_rk("code", p))
        return
    _store.pop(p, None)


def _bump_fail(p: str, now: float) -> None:
    r = _redis_client()
    if r:
        key = _rk("fails", p)
        n = int(r.incr(key))
        r.expire(key, _LOCK_SECONDS)
        if n >= _MAX_VERIFY_FAILS:
            _set_lock(p, now + _LOCK_SECONDS)
            r.delete(key)
        return
    _fail_count[p] += 1
    if _fail_count[p] >= _MAX_VERIFY_FAILS:
        _lock_until[p] = now + _LOCK_SECONDS
        _fail_count[p] = 0


def _clear_fails(p: str) -> None:
    r = _redis_client()
    if r:
        r.delete(_rk("fails", p), _rk("lock", p))
        return
    _fail_count.pop(p, None)
    _lock_until.pop(p, None)


async def send_otp(phone: str) -> dict:
    p = _norm(phone)
    if len(p) < 10:
        return {"ok": False, "message": "Некорректный номер"}
    now = time.time()
    left = _lock_left(p, now)
    if left > 0:
        return {"ok": False, "message": f"Слишком много попыток. Повторите через {left // 60 + 1} мин", "locked": True}
    _prune_sends(p, now)
    last = _last_send(p)
    if last and (now - last) < _RESEND_COOLDOWN:
        wait = int(_RESEND_COOLDOWN - (now - last)) + 1
        return {"ok": False, "message": f"Повторная отправка через {wait} с", "rate_limited": True}
    if _send_count(p, now) >= _MAX_SENDS:
        return {"ok": False, "message": "Лимит SMS исчерпан. Подождите 10 минут", "rate_limited": True}

    code = f"{secrets.randbelow(1_000_000):06d}"
    _store_code(p, code, now + _TTL)
    _record_send(p, now)
    sms = await send_sms(phone, f"Renova: код входа {code}")
    out: dict = {"ok": True, "message": "Код отправлен", "store": "redis" if _redis_client() else "memory"}
    if settings.normalized_environment in ("development", "test"):
        out["demo_code"] = code
        if sms.get("demo"):
            out["demo"] = True
    return out


def verify_otp(phone: str, code: str) -> bool:
    p = _norm(phone)
    now = time.time()
    if _lock_left(p, now) > 0:
        return False
    rec = _get_code(p)
    if not rec:
        _bump_fail(p, now)
        return False
    stored, exp = rec
    if now > exp:
        _clear_code(p)
        return False
    if stored != code.strip():
        _bump_fail(p, now)
        if _lock_left(p, time.time()) > 0:
            _clear_code(p)
        return False
    _clear_code(p)
    _clear_fails(p)
    return True
