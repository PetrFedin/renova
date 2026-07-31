"""SMS OTP with shared-store integrity and truthful provider delivery."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
import threading
import time
from collections import defaultdict

from redis.exceptions import RedisError

from app.core.config import settings
from app.core.phone import InvalidPhoneNumber, normalize_phone
from app.services.sms_service import SmsConfigurationError, SmsDeliveryFailed, send_sms

logger = logging.getLogger("renova.otp")

_TTL = 300
_SEND_WINDOW = 600
_MAX_SENDS = 5
_RESEND_COOLDOWN = 60
_MAX_VERIFY_FAILS = 5
_LOCK_SECONDS = 900
_SEND_CLAIM_SECONDS = 30

# One Redis script owns verify, attempts, lockout and consume. A successful code
# is deleted in the same atomic operation, so two workers cannot both accept it.
_VERIFY_OTP_SCRIPT = """
local lock_key = KEYS[1]
local code_key = KEYS[2]
local fails_key = KEYS[3]
local candidate = ARGV[1]
local max_fails = tonumber(ARGV[2])
local lock_seconds = tonumber(ARGV[3])
local lock_until = ARGV[4]

if redis.call('exists', lock_key) == 1 then
    return 'locked'
end

local stored = redis.call('get', code_key)
if not stored then
    local failures = redis.call('incr', fails_key)
    redis.call('expire', fails_key, lock_seconds)
    if failures >= max_fails then
        redis.call('set', lock_key, lock_until, 'EX', lock_seconds)
        redis.call('del', fails_key)
        return 'locked'
    end
    return 'missing'
end

if stored ~= candidate then
    local failures = redis.call('incr', fails_key)
    redis.call('expire', fails_key, lock_seconds)
    if failures >= max_fails then
        redis.call('set', lock_key, lock_until, 'EX', lock_seconds)
        redis.call('del', fails_key)
        redis.call('del', code_key)
        return 'locked'
    end
    return 'mismatch'
end

redis.call('del', code_key)
redis.call('del', fails_key)
redis.call('del', lock_key)
return 'ok'
"""

_store: dict[str, tuple[str, float]] = {}
_send_log: dict[str, list[float]] = defaultdict(list)
_fail_count: dict[str, int] = defaultdict(int)
_lock_until: dict[str, float] = {}
_send_locks: dict[str, asyncio.Lock] = {}
_send_locks_guard = threading.Lock()
_verify_locks: dict[str, threading.Lock] = {}
_verify_locks_guard = threading.Lock()

_redis = None
_redis_failed = False


class OtpStoreUnavailable(RuntimeError):
    pass


def _working_environment() -> bool:
    return settings.normalized_environment in {"staging", "production"}


def _norm(phone: str) -> str:
    return normalize_phone(phone)


def _digest(phone: str, code: str) -> str:
    message = f"{phone}:{code}".encode("utf-8")
    return hmac.new(settings.secret_key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _mark_redis_unavailable() -> OtpStoreUnavailable:
    global _redis, _redis_failed
    _redis = None
    _redis_failed = True
    return OtpStoreUnavailable("redis_unavailable_for_otp")


def _redis_client():
    global _redis, _redis_failed
    url = (settings.redis_url or "").strip()
    if not url:
        if _working_environment():
            raise OtpStoreUnavailable("redis_required_for_otp")
        return None
    if _redis_failed:
        if _working_environment():
            raise OtpStoreUnavailable("redis_unavailable_for_otp")
        return None
    if _redis is not None:
        return _redis
    try:
        import redis

        _redis = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
        )
        _redis.ping()
        logger.info("otp store: redis")
        return _redis
    except Exception as exc:
        _redis_failed = True
        _redis = None
        if _working_environment():
            raise OtpStoreUnavailable("redis_unavailable_for_otp") from exc
        logger.warning("otp store: redis unavailable — local memory preview only", exc_info=True)
        return None


def _rk(kind: str, phone: str) -> str:
    return f"renova:otp:{kind}:{phone}"


def _local_send_lock(phone: str) -> asyncio.Lock:
    # Two coroutines can reach this function before either stores its lock. The
    # guard makes lock creation atomic so one phone always has one process lock.
    with _send_locks_guard:
        lock = _send_locks.get(phone)
        if lock is None:
            lock = asyncio.Lock()
            _send_locks[phone] = lock
        return lock


def _local_verify_lock(phone: str) -> threading.Lock:
    with _verify_locks_guard:
        lock = _verify_locks.get(phone)
        if lock is None:
            lock = threading.Lock()
            _verify_locks[phone] = lock
        return lock


def _acquire_distributed_send_claim(phone: str) -> str | None:
    redis_client = _redis_client()
    if redis_client is None:
        return None
    token = secrets.token_urlsafe(18)
    acquired = redis_client.set(
        _rk("send-claim", phone),
        token,
        nx=True,
        ex=_SEND_CLAIM_SECONDS,
    )
    return token if acquired else ""


def _release_distributed_send_claim(phone: str, token: str | None) -> None:
    if not token:
        return
    redis_client = _redis_client()
    if redis_client is None:
        return
    redis_client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
        "return redis.call('del', KEYS[1]) else return 0 end",
        1,
        _rk("send-claim", phone),
        token,
    )


def _prune_sends(phone: str, now: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.zremrangebyscore(_rk("sends", phone), 0, now - _SEND_WINDOW)
        return
    _send_log[phone] = [sent_at for sent_at in _send_log[phone] if now - sent_at < _SEND_WINDOW]


def _send_count(phone: str, now: float) -> int:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("sends", phone)
        redis_client.zremrangebyscore(key, 0, now - _SEND_WINDOW)
        return int(redis_client.zcard(key))
    return len(_send_log[phone])


def _last_send(phone: str) -> float:
    redis_client = _redis_client()
    if redis_client:
        rows = redis_client.zrevrange(_rk("sends", phone), 0, 0, withscores=True)
        return float(rows[0][1]) if rows else 0.0
    return _send_log[phone][-1] if _send_log[phone] else 0.0


def _record_send(phone: str, now: float) -> str | float:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("sends", phone)
        member = f"{now:.6f}:{secrets.token_hex(4)}"
        redis_client.zadd(key, {member: now})
        redis_client.expire(key, _SEND_WINDOW + 60)
        return member
    _send_log[phone].append(now)
    return now


def _remove_send_record(phone: str, record: str | float) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.zrem(_rk("sends", phone), str(record))
        return
    try:
        _send_log[phone].remove(float(record))
    except (ValueError, TypeError):
        pass


def _lock_left(phone: str, now: float) -> int:
    redis_client = _redis_client()
    if redis_client:
        raw = redis_client.get(_rk("lock", phone))
        if not raw:
            return 0
        return max(0, int(float(raw) - now))
    return max(0, int(_lock_until.get(phone, 0) - now))


def _set_lock(phone: str, until: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        ttl = max(1, int(until - time.time()))
        redis_client.setex(_rk("lock", phone), ttl, str(until))
        return
    _lock_until[phone] = until


def _store_code(phone: str, digest: str, expires_at: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        ttl = max(1, int(expires_at - time.time()))
        redis_client.setex(_rk("code", phone), ttl, digest)
        return
    _store[phone] = (digest, expires_at)


def _get_code(phone: str) -> tuple[str, float] | None:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("code", phone)
        digest = redis_client.get(key)
        if not digest:
            return None
        ttl = redis_client.ttl(key)
        expires_at = time.time() + (ttl if ttl and ttl > 0 else 0)
        return str(digest), expires_at
    return _store.get(phone)


def _clear_code(phone: str) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.delete(_rk("code", phone))
        return
    _store.pop(phone, None)


def _clear_code_if_matches(phone: str, expected_digest: str) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then "
            "return redis.call('del', KEYS[1]) else return 0 end",
            1,
            _rk("code", phone),
            expected_digest,
        )
        return
    current = _store.get(phone)
    if current and hmac.compare_digest(current[0], expected_digest):
        _store.pop(phone, None)


def _restore_code(phone: str, previous: tuple[str, float] | None) -> None:
    if previous and previous[1] > time.time():
        _store_code(phone, previous[0], previous[1])
    else:
        _clear_code(phone)


def _bump_fail(phone: str, now: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("fails", phone)
        failures = int(redis_client.incr(key))
        redis_client.expire(key, _LOCK_SECONDS)
        if failures >= _MAX_VERIFY_FAILS:
            _set_lock(phone, now + _LOCK_SECONDS)
            redis_client.delete(key)
        return
    _fail_count[phone] += 1
    if _fail_count[phone] >= _MAX_VERIFY_FAILS:
        _lock_until[phone] = now + _LOCK_SECONDS
        _fail_count[phone] = 0


def _clear_fails(phone: str) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.delete(_rk("fails", phone), _rk("lock", phone))
        return
    _fail_count.pop(phone, None)
    _lock_until.pop(phone, None)


async def send_otp(phone: str) -> dict:
    try:
        normalized = _norm(phone)
    except InvalidPhoneNumber:
        return {"ok": False, "message": "Некорректный номер"}

    async with _local_send_lock(normalized):
        claim: str | None = None
        try:
            claim = _acquire_distributed_send_claim(normalized)
            if claim == "":
                return {
                    "ok": False,
                    "message": "Отправка уже выполняется. Повторите через несколько секунд",
                    "rate_limited": True,
                }

            now = time.time()
            lock_left = _lock_left(normalized, now)
            if lock_left > 0:
                return {
                    "ok": False,
                    "message": f"Слишком много попыток. Повторите через {lock_left // 60 + 1} мин",
                    "locked": True,
                }
            _prune_sends(normalized, now)
            last = _last_send(normalized)
            if last and (now - last) < _RESEND_COOLDOWN:
                wait = int(_RESEND_COOLDOWN - (now - last)) + 1
                return {
                    "ok": False,
                    "message": f"Повторная отправка через {wait} с",
                    "rate_limited": True,
                }
            if _send_count(normalized, now) >= _MAX_SENDS:
                return {
                    "ok": False,
                    "message": "Лимит SMS исчерпан. Подождите 10 минут",
                    "rate_limited": True,
                }

            code = f"{secrets.randbelow(1_000_000):06d}"
            code_digest = _digest(normalized, code)
            previous = _get_code(normalized)
            _store_code(normalized, code_digest, now + _TTL)
            send_record = _record_send(normalized, now)

            try:
                delivery = await send_sms(normalized, f"Renova: код входа {code}")
            except (SmsConfigurationError, SmsDeliveryFailed) as exc:
                _clear_code_if_matches(normalized, code_digest)
                _restore_code(normalized, previous)
                _remove_send_record(normalized, send_record)
                logger.warning("otp SMS delivery failed", extra={"error_type": type(exc).__name__})
                return {
                    "ok": False,
                    "message": "SMS временно недоступна. Повторите позже",
                    "service_unavailable": True,
                }

            if not delivery.delivered and not delivery.preview:
                _clear_code_if_matches(normalized, code_digest)
                _restore_code(normalized, previous)
                _remove_send_record(normalized, send_record)
                return {
                    "ok": False,
                    "message": "SMS временно недоступна. Повторите позже",
                    "service_unavailable": True,
                }

            response: dict = {"ok": True, "message": "Код отправлен"}
            if delivery.preview:
                if _working_environment():
                    _clear_code_if_matches(normalized, code_digest)
                    _restore_code(normalized, previous)
                    _remove_send_record(normalized, send_record)
                    return {
                        "ok": False,
                        "message": "SMS не настроена",
                        "service_unavailable": True,
                    }
                response.update({"preview": True, "demo_code": code})
            return response
        except OtpStoreUnavailable:
            return {
                "ok": False,
                "message": "Сервис кодов временно недоступен",
                "service_unavailable": True,
            }
        except RedisError:
            logger.exception("otp Redis operation failed")
            _mark_redis_unavailable()
            return {
                "ok": False,
                "message": "Сервис кодов временно недоступен",
                "service_unavailable": True,
            }
        finally:
            try:
                _release_distributed_send_claim(normalized, claim)
            except (OtpStoreUnavailable, RedisError):
                _mark_redis_unavailable()
                logger.warning("otp send claim release failed")


def _verify_local(phone: str, candidate: str, now: float) -> bool:
    with _local_verify_lock(phone):
        if _lock_until.get(phone, 0) > now:
            return False

        record = _store.get(phone)
        if not record:
            _fail_count[phone] += 1
            if _fail_count[phone] >= _MAX_VERIFY_FAILS:
                _lock_until[phone] = now + _LOCK_SECONDS
                _fail_count[phone] = 0
            return False

        stored_digest, expires_at = record
        if now > expires_at:
            _store.pop(phone, None)
            return False

        if not hmac.compare_digest(stored_digest, candidate):
            _fail_count[phone] += 1
            if _fail_count[phone] >= _MAX_VERIFY_FAILS:
                _lock_until[phone] = now + _LOCK_SECONDS
                _fail_count[phone] = 0
                _store.pop(phone, None)
            return False

        _store.pop(phone, None)
        _fail_count.pop(phone, None)
        _lock_until.pop(phone, None)
        return True


def verify_otp(phone: str, code: str) -> bool:
    try:
        normalized = _norm(phone)
    except InvalidPhoneNumber:
        return False

    try:
        now = time.time()
        candidate = _digest(normalized, code.strip())
        redis_client = _redis_client()
        if redis_client is None:
            return _verify_local(normalized, candidate, now)

        result = redis_client.eval(
            _VERIFY_OTP_SCRIPT,
            3,
            _rk("lock", normalized),
            _rk("code", normalized),
            _rk("fails", normalized),
            candidate,
            _MAX_VERIFY_FAILS,
            _LOCK_SECONDS,
            str(now + _LOCK_SECONDS),
        )
        return str(result) == "ok"
    except OtpStoreUnavailable:
        raise
    except (RedisError, AttributeError) as exc:
        logger.exception("otp Redis atomic verification failed")
        raise _mark_redis_unavailable() from exc
