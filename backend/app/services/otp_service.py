"""SMS OTP with shared-store integrity and truthful provider delivery."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import math
import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass

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
_REDIS_CODE_PREFIX = "v2|"

# Store the authoritative deadline with the digest and derive it from Redis TIME.
# The PX lifetime is cleanup only; verification uses the embedded deadline, so
# integer TTL rounding can never extend an OTP's security validity window.
_STORE_OTP_SCRIPT = """
local code_key = KEYS[1]
local generation_key = KEYS[2]
local digest = ARGV[1]
local ttl_ms = tonumber(ARGV[2])
if not ttl_ms or ttl_ms <= 0 then
    redis.call('del', code_key)
    redis.call('del', generation_key)
    return 0
end
local server_time = redis.call('time')
local now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
local deadline_ms = now_ms + ttl_ms
redis.call('set', code_key, 'v2|' .. tostring(deadline_ms) .. '|' .. digest, 'PX', ttl_ms)
redis.call('del', generation_key)
return deadline_ms
"""

# Replace the active code and snapshot its previous still-valid value in one
# Redis operation. Legacy raw digests are normalized to versioned records so a
# later rollback can retain the original absolute security deadline.
_SWAP_OTP_SCRIPT = """
local code_key = KEYS[1]
local generation_key = KEYS[2]
local digest = ARGV[1]
local ttl_ms = tonumber(ARGV[2])
local generation = ARGV[3]
if not ttl_ms or ttl_ms <= 0 then
    return ''
end

local server_time = redis.call('time')
local now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
local previous = ''
local stored = redis.call('get', code_key)
if stored then
    local previous_deadline, previous_digest = string.match(stored, '^v2|(%d+)|(.+)$')
    if previous_deadline then
        if now_ms < tonumber(previous_deadline) then
            previous = stored
        end
    elseif string.sub(stored, 1, 3) ~= 'v2|' then
        local previous_ttl = redis.call('pttl', code_key)
        if previous_ttl and previous_ttl > 0 then
            previous = 'v2|' .. tostring(now_ms + previous_ttl) .. '|' .. stored
        end
    end
end

local deadline_ms = now_ms + ttl_ms
redis.call('set', code_key, 'v2|' .. tostring(deadline_ms) .. '|' .. digest, 'PX', ttl_ms)
redis.call('set', generation_key, generation, 'PX', ttl_ms)
return previous
"""

# Restore the previous code only while this exact replacement generation is
# still active. If the new code was consumed, expired, cleared, or superseded,
# rollback is rejected and an older credential can never be resurrected.
_ROLLBACK_OTP_SCRIPT = """
local code_key = KEYS[1]
local generation_key = KEYS[2]
local expected_generation = ARGV[1]
local previous = ARGV[2]

if redis.call('get', generation_key) ~= expected_generation then
    return 0
end
if redis.call('exists', code_key) == 0 then
    redis.call('del', generation_key)
    return 0
end

if previous ~= '' then
    local previous_deadline, previous_digest = string.match(previous, '^v2|(%d+)|(.+)$')
    if previous_deadline and previous_digest then
        local server_time = redis.call('time')
        local now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
        local remaining_ms = tonumber(previous_deadline) - now_ms
        if remaining_ms > 0 then
            redis.call('set', code_key, previous, 'PX', remaining_ms)
        else
            redis.call('del', code_key)
        end
    else
        redis.call('del', code_key)
    end
else
    redis.call('del', code_key)
end
redis.call('del', generation_key)
return 1
"""

_CLEAR_OTP_IF_DIGEST_SCRIPT = """
local stored = redis.call('get', KEYS[1])
if not stored then
    redis.call('del', KEYS[2])
    return 0
end
if stored == ARGV[1] then
    redis.call('del', KEYS[1])
    redis.call('del', KEYS[2])
    return 1
end
local _, stored_digest = string.match(stored, '^v2|(%d+)|(.+)$')
if stored_digest == ARGV[1] then
    redis.call('del', KEYS[1])
    redis.call('del', KEYS[2])
    return 1
end
return 0
"""

# Redis owns verification, attempts, lockout, expiry and consume. Successful
# verification deletes the code and replacement generation atomically, so a
# later delivery rollback cannot restore an already-used credential.
_VERIFY_OTP_SCRIPT = """
local lock_key = KEYS[1]
local code_key = KEYS[2]
local fails_key = KEYS[3]
local generation_key = KEYS[4]
local candidate = ARGV[1]
local max_fails = tonumber(ARGV[2])
local lock_seconds = tonumber(ARGV[3])

local function register_failure(reason)
    local failures = redis.call('incr', fails_key)
    redis.call('expire', fails_key, lock_seconds)
    if failures >= max_fails then
        local server_time = redis.call('time')
        local lock_until = tonumber(server_time[1]) + lock_seconds
        redis.call('set', lock_key, tostring(lock_until), 'EX', lock_seconds)
        redis.call('del', fails_key)
        redis.call('del', code_key)
        redis.call('del', generation_key)
        return 'locked'
    end
    return reason
end

if redis.call('exists', lock_key) == 1 then
    return 'locked'
end

local stored = redis.call('get', code_key)
if not stored then
    redis.call('del', generation_key)
    return register_failure('missing')
end

local deadline_raw, stored_digest = string.match(stored, '^v2|(%d+)|(.+)$')
if deadline_raw then
    local server_time = redis.call('time')
    local now_ms = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
    if now_ms >= tonumber(deadline_raw) then
        redis.call('del', code_key)
        redis.call('del', generation_key)
        return register_failure('expired')
    end
else
    -- Rolling-deploy compatibility for raw digest records created by v1.
    stored_digest = stored
end

if stored_digest ~= candidate then
    return register_failure('mismatch')
end

redis.call('del', code_key)
redis.call('del', generation_key)
redis.call('del', fails_key)
redis.call('del', lock_key)
return 'ok'
"""

_store: dict[str, tuple[str, float]] = {}
_code_generation: dict[str, str] = {}
_send_log: dict[str, list[float]] = defaultdict(list)
_fail_count: dict[str, int] = defaultdict(int)
_lock_until: dict[str, float] = {}
_send_locks: dict[str, asyncio.Lock] = {}
_send_inflight: set[str] = set()
_send_locks_guard = threading.Lock()
_verify_locks: dict[str, threading.Lock] = {}
_verify_locks_guard = threading.Lock()

_redis = None
_redis_failed = False


class OtpStoreUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class OtpSwap:
    generation: str
    redis_backed: bool
    previous_local: tuple[str, float] | None = None
    previous_raw: str | None = None


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


def _redis_time_seconds(redis_client) -> float:
    seconds, microseconds = redis_client.time()
    return float(seconds) + (float(microseconds) / 1_000_000)


def _unpack_redis_code(raw: str) -> tuple[str, int | None]:
    if not raw.startswith(_REDIS_CODE_PREFIX):
        return raw, None
    try:
        _, deadline_raw, digest = raw.split("|", 2)
        return digest, int(deadline_raw)
    except (TypeError, ValueError):
        return "", 0


def _local_send_lock(phone: str) -> asyncio.Lock:
    with _send_locks_guard:
        lock = _send_locks.get(phone)
        if lock is None:
            lock = asyncio.Lock()
            _send_locks[phone] = lock
        return lock


def _claim_local_send(phone: str) -> bool:
    """Reject a same-process double tap before either call reaches the provider."""
    with _send_locks_guard:
        if phone in _send_inflight:
            return False
        _send_inflight.add(phone)
        return True


def _release_local_send(phone: str) -> None:
    with _send_locks_guard:
        _send_inflight.discard(phone)


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
        remaining_ms = int(redis_client.pttl(_rk("lock", phone)))
        return max(0, math.ceil(remaining_ms / 1000)) if remaining_ms > 0 else 0
    return max(0, math.ceil(_lock_until.get(phone, 0) - now))


def _set_lock(phone: str, until: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        ttl = max(1, math.ceil(until - time.time()))
        redis_client.setex(_rk("lock", phone), ttl, str(until))
        return
    _lock_until[phone] = until


def _store_code(phone: str, digest: str, expires_at: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        remaining_ms = math.ceil((expires_at - time.time()) * 1000)
        if remaining_ms <= 0:
            redis_client.delete(_rk("code", phone), _rk("code-generation", phone))
            return
        redis_client.eval(
            _STORE_OTP_SCRIPT,
            2,
            _rk("code", phone),
            _rk("code-generation", phone),
            digest,
            remaining_ms,
        )
        return
    with _local_verify_lock(phone):
        _store[phone] = (digest, expires_at)
        _code_generation.pop(phone, None)


def _swap_code(phone: str, digest: str, expires_at: float) -> OtpSwap:
    generation = secrets.token_urlsafe(18)
    redis_client = _redis_client()
    if redis_client:
        remaining_ms = math.ceil((expires_at - time.time()) * 1000)
        if remaining_ms <= 0:
            raise ValueError("otp_expiry_must_be_future")
        previous = redis_client.eval(
            _SWAP_OTP_SCRIPT,
            2,
            _rk("code", phone),
            _rk("code-generation", phone),
            digest,
            remaining_ms,
            generation,
        )
        return OtpSwap(
            generation=generation,
            redis_backed=True,
            previous_raw=str(previous) if previous else None,
        )

    now = time.time()
    with _local_verify_lock(phone):
        previous = _store.get(phone)
        if previous and previous[1] <= now:
            previous = None
        _store[phone] = (digest, expires_at)
        _code_generation[phone] = generation
    return OtpSwap(
        generation=generation,
        redis_backed=False,
        previous_local=previous,
    )


def _rollback_code(phone: str, swap: OtpSwap) -> bool:
    if swap.redis_backed:
        redis_client = _redis_client()
        if redis_client is None:
            raise OtpStoreUnavailable("redis_unavailable_for_otp_rollback")
        restored = redis_client.eval(
            _ROLLBACK_OTP_SCRIPT,
            2,
            _rk("code", phone),
            _rk("code-generation", phone),
            swap.generation,
            swap.previous_raw or "",
        )
        return bool(int(restored))

    now = time.time()
    with _local_verify_lock(phone):
        if _code_generation.get(phone) != swap.generation:
            return False
        if phone not in _store:
            _code_generation.pop(phone, None)
            return False
        if swap.previous_local and swap.previous_local[1] > now:
            _store[phone] = swap.previous_local
        else:
            _store.pop(phone, None)
        _code_generation.pop(phone, None)
        return True


def _get_code(phone: str) -> tuple[str, float] | None:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("code", phone)
        raw = redis_client.get(key)
        if not raw:
            return None
        digest, deadline_ms = _unpack_redis_code(str(raw))
        if deadline_ms is not None:
            now_ms = math.floor(_redis_time_seconds(redis_client) * 1000)
            if not digest or now_ms >= deadline_ms:
                redis_client.delete(key, _rk("code-generation", phone))
                return None
            return digest, time.time() + ((deadline_ms - now_ms) / 1000)
        remaining_ms = int(redis_client.pttl(key))
        if remaining_ms <= 0:
            return None
        return digest, time.time() + (remaining_ms / 1000)
    return _store.get(phone)


def _clear_code(phone: str) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.delete(_rk("code", phone), _rk("code-generation", phone))
        return
    with _local_verify_lock(phone):
        _store.pop(phone, None)
        _code_generation.pop(phone, None)


def _clear_code_if_matches(phone: str, expected_digest: str) -> None:
    redis_client = _redis_client()
    if redis_client:
        redis_client.eval(
            _CLEAR_OTP_IF_DIGEST_SCRIPT,
            2,
            _rk("code", phone),
            _rk("code-generation", phone),
            expected_digest,
        )
        return
    with _local_verify_lock(phone):
        current = _store.get(phone)
        if current and hmac.compare_digest(current[0], expected_digest):
            _store.pop(phone, None)
            _code_generation.pop(phone, None)


def _bump_fail(phone: str, now: float) -> None:
    redis_client = _redis_client()
    if redis_client:
        key = _rk("fails", phone)
        failures = int(redis_client.incr(key))
        redis_client.expire(key, _LOCK_SECONDS)
        if failures >= _MAX_VERIFY_FAILS:
            _set_lock(phone, now + _LOCK_SECONDS)
            redis_client.delete(key, _rk("code", phone), _rk("code-generation", phone))
        return
    _fail_count[phone] += 1
    if _fail_count[phone] >= _MAX_VERIFY_FAILS:
        _lock_until[phone] = now + _LOCK_SECONDS
        _fail_count[phone] = 0
        _store.pop(phone, None)
        _code_generation.pop(phone, None)


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

    if not _claim_local_send(normalized):
        return {
            "ok": False,
            "message": "Отправка уже выполняется. Повторите через несколько секунд",
            "rate_limited": True,
        }

    try:
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

                redis_client = _redis_client()
                now = _redis_time_seconds(redis_client) if redis_client else time.time()
                lock_left = _lock_left(normalized, now)
                if lock_left > 0:
                    minutes = max(1, math.ceil(lock_left / 60))
                    return {
                        "ok": False,
                        "message": f"Слишком много попыток. Повторите через {minutes} мин",
                        "locked": True,
                    }
                _prune_sends(normalized, now)
                last = _last_send(normalized)
                if last and (now - last) < _RESEND_COOLDOWN:
                    wait = max(1, math.ceil(_RESEND_COOLDOWN - (now - last)))
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
                swap = _swap_code(normalized, code_digest, time.time() + _TTL)
                send_record = _record_send(normalized, now)

                try:
                    delivery = await send_sms(normalized, f"Renova: код входа {code}")
                except (SmsConfigurationError, SmsDeliveryFailed) as exc:
                    _rollback_code(normalized, swap)
                    _remove_send_record(normalized, send_record)
                    logger.warning("otp SMS delivery failed", extra={"error_type": type(exc).__name__})
                    return {
                        "ok": False,
                        "message": "SMS временно недоступна. Повторите позже",
                        "service_unavailable": True,
                    }

                if not delivery.delivered and not delivery.preview:
                    _rollback_code(normalized, swap)
                    _remove_send_record(normalized, send_record)
                    return {
                        "ok": False,
                        "message": "SMS временно недоступна. Повторите позже",
                        "service_unavailable": True,
                    }

                response: dict = {"ok": True, "message": "Код отправлен"}
                if delivery.preview:
                    if _working_environment():
                        _rollback_code(normalized, swap)
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
    finally:
        _release_local_send(normalized)


def _verify_local(phone: str, candidate: str, now: float) -> bool:
    with _local_verify_lock(phone):
        if _lock_until.get(phone, 0) > now:
            return False

        record = _store.get(phone)
        if not record:
            _code_generation.pop(phone, None)
            _fail_count[phone] += 1
            if _fail_count[phone] >= _MAX_VERIFY_FAILS:
                _lock_until[phone] = now + _LOCK_SECONDS
                _fail_count[phone] = 0
            return False

        stored_digest, expires_at = record
        if now >= expires_at:
            _store.pop(phone, None)
            _code_generation.pop(phone, None)
            return False

        if not hmac.compare_digest(stored_digest, candidate):
            _fail_count[phone] += 1
            if _fail_count[phone] >= _MAX_VERIFY_FAILS:
                _lock_until[phone] = now + _LOCK_SECONDS
                _fail_count[phone] = 0
                _store.pop(phone, None)
                _code_generation.pop(phone, None)
            return False

        _store.pop(phone, None)
        _code_generation.pop(phone, None)
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
            4,
            _rk("lock", normalized),
            _rk("code", normalized),
            _rk("fails", normalized),
            _rk("code-generation", normalized),
            candidate,
            _MAX_VERIFY_FAILS,
            _LOCK_SECONDS,
        )
        return str(result) == "ok"
    except OtpStoreUnavailable:
        raise
    except (RedisError, AttributeError) as exc:
        logger.exception("otp Redis atomic verification failed")
        raise _mark_redis_unavailable() from exc
