"""Multi-dimensional OTP abuse guard for phone, IP and device identity."""
from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass

from redis.exceptions import RedisError

from app.services import otp_service

_WINDOW_SECONDS = 900
_SEND_LIMITS = {"phone": 5, "ip": 20, "device": 10}
_VERIFY_LIMITS = {"phone": 20, "ip": 60, "device": 30}

_RATE_LIMIT_SCRIPT = """
local window = tonumber(ARGV[1])
for index = 1, #KEYS do
    local current = redis.call('incr', KEYS[index])
    if current == 1 then
        redis.call('expire', KEYS[index], window)
    end
    local limit = tonumber(ARGV[index + 1])
    if current > limit then
        local ttl = redis.call('ttl', KEYS[index])
        return {0, index, ttl}
    end
end
return {1, 0, 0}
"""


@dataclass(frozen=True)
class OtpAbuseDecision:
    allowed: bool
    retry_after: int = 0
    dimension: str | None = None


_local_counts: dict[str, tuple[int, float]] = {}
_local_lock = threading.Lock()


def _fingerprint(value: str | None) -> str:
    normalized = (value or "unknown").strip().lower() or "unknown"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def _dimensions(*, phone: str, ip: str | None, device_id: str | None) -> list[tuple[str, str]]:
    dimensions = [("phone", _fingerprint(phone)), ("ip", _fingerprint(ip))]
    if device_id:
        dimensions.append(("device", _fingerprint(device_id)))
    return dimensions


def _key(action: str, dimension: str, fingerprint: str) -> str:
    return f"renova:otp:abuse:{action}:{dimension}:{fingerprint}"


def _limits(action: str) -> dict[str, int]:
    if action == "send":
        return _SEND_LIMITS
    if action == "verify":
        return _VERIFY_LIMITS
    raise ValueError("otp_abuse_action_invalid")


def _check_local(action: str, dimensions: list[tuple[str, str]], now: float) -> OtpAbuseDecision:
    limits = _limits(action)
    with _local_lock:
        for dimension, fingerprint in dimensions:
            key = _key(action, dimension, fingerprint)
            count, expires_at = _local_counts.get(key, (0, now + _WINDOW_SECONDS))
            if expires_at <= now:
                count, expires_at = 0, now + _WINDOW_SECONDS
            count += 1
            _local_counts[key] = (count, expires_at)
            if count > limits[dimension]:
                return OtpAbuseDecision(
                    allowed=False,
                    retry_after=max(1, int(expires_at - now)),
                    dimension=dimension,
                )
    return OtpAbuseDecision(allowed=True)


def check_and_record(
    action: str,
    *,
    phone: str,
    ip: str | None,
    device_id: str | None,
) -> OtpAbuseDecision:
    """Atomically consume one abuse-budget unit across available dimensions."""
    dimensions = _dimensions(phone=phone, ip=ip, device_id=device_id)
    redis_client = otp_service._redis_client()
    if redis_client is None:
        return _check_local(action, dimensions, time.time())

    limits = _limits(action)
    keys = [_key(action, dimension, fingerprint) for dimension, fingerprint in dimensions]
    args = [_WINDOW_SECONDS, *[limits[dimension] for dimension, _ in dimensions]]
    try:
        result = redis_client.eval(_RATE_LIMIT_SCRIPT, len(keys), *keys, *args)
    except RedisError as exc:
        raise otp_service._mark_redis_unavailable() from exc

    allowed = bool(int(result[0]))
    if allowed:
        return OtpAbuseDecision(allowed=True)
    index = max(1, int(result[1])) - 1
    retry_after = max(1, int(result[2] or _WINDOW_SECONDS))
    return OtpAbuseDecision(
        allowed=False,
        retry_after=retry_after,
        dimension=dimensions[index][0],
    )


def reset_local_state() -> None:
    """Test helper; production state is Redis-backed."""
    with _local_lock:
        _local_counts.clear()
