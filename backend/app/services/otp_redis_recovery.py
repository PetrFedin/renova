"""Fail-closed, bounded recovery for the shared OTP Redis store.

The OTP service intentionally marks Redis unavailable after a runtime command
failure. This coordinator keeps working environments fail closed while
allowing a later request (or startup probe) to reconnect after a bounded
exponential backoff. Only one thread performs a probe, preventing a Redis
outage from turning into a reconnect storm.
"""
from __future__ import annotations

import asyncio
import logging
import math
import threading
import time

from app.core.config import settings
from app.services import otp_service

logger = logging.getLogger("renova.otp.recovery")

_RETRY_BASE_SECONDS = 1.0
_RETRY_MAX_SECONDS = 30.0
_MAX_FAILURE_EXPONENT = 6

_state_lock = threading.RLock()
_probe_lock = threading.Lock()
_failure_count = 0
_retry_at = 0.0


def _working_environment() -> bool:
    return settings.normalized_environment in {"staging", "production"}


def _unavailable() -> otp_service.OtpStoreUnavailable:
    return otp_service.OtpStoreUnavailable("redis_unavailable_for_otp")


def _record_failure(now: float) -> float:
    global _failure_count, _retry_at
    with _state_lock:
        _failure_count = min(_failure_count + 1, _MAX_FAILURE_EXPONENT + 1)
        exponent = min(_failure_count - 1, _MAX_FAILURE_EXPONENT)
        delay = min(_RETRY_BASE_SECONDS * (2**exponent), _RETRY_MAX_SECONDS)
        _retry_at = now + delay
        return delay


def _reset_recovery_state() -> None:
    global _failure_count, _retry_at
    with _state_lock:
        _failure_count = 0
        _retry_at = 0.0


def recovery_snapshot() -> dict[str, int | bool | str]:
    """Return aggregate runtime truth without Redis coordinates or errors."""
    now = time.monotonic()
    required = _working_environment()
    configured = bool((settings.redis_url or "").strip())
    failed = bool(otp_service._redis_failed)
    connected = otp_service._redis is not None and not failed

    with _state_lock:
        retry_after_seconds = max(0, math.ceil(_retry_at - now))
        failure_count = _failure_count

    if failed:
        status = "critical"
    elif required and (not configured or not connected):
        # A live process must never advertise working OTP auth without its
        # required shared store. Startup normally prevents this state; if it is
        # observed later, release health must surface it as critical.
        status = "critical"
    elif connected:
        status = "healthy"
    elif configured:
        status = "unknown"
    else:
        status = "not_required"

    return {
        "healthy": status in {"healthy", "not_required"},
        "status": status,
        "required": required,
        "configured": configured,
        "connected": connected,
        "failed": failed,
        "failure_count": failure_count,
        "retry_after_seconds": retry_after_seconds,
    }


def _existing_client():
    client = otp_service._redis
    if client is not None and not otp_service._redis_failed:
        _reset_recovery_state()
        return client
    return None


def _probe_redis():
    import redis

    client = redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=1.5,
        socket_timeout=1.5,
    )
    client.ping()
    return client


def ensure_otp_store_sync(*, force: bool = False):
    """Return a healthy shared store or fail closed in working environments."""
    existing = _existing_client()
    if existing is not None:
        return existing

    url = (settings.redis_url or "").strip()
    if not url:
        # Preserve the OTP service contract: production requires Redis while
        # development/test may intentionally use the in-process preview store.
        return otp_service._redis_client()

    now = time.monotonic()
    with _state_lock:
        if not force and _retry_at > now:
            if _working_environment():
                raise _unavailable()
            return None

    with _probe_lock:
        existing = _existing_client()
        if existing is not None:
            return existing

        now = time.monotonic()
        with _state_lock:
            if not force and _retry_at > now:
                if _working_environment():
                    raise _unavailable()
                return None

        try:
            client = _probe_redis()
        except Exception as exc:
            otp_service._redis = None
            otp_service._redis_failed = True
            delay = _record_failure(time.monotonic())
            logger.warning(
                "OTP Redis recovery probe failed; retry scheduled",
                extra={"retry_after_seconds": delay},
            )
            if _working_environment():
                raise _unavailable() from exc
            return None

        otp_service._redis = client
        otp_service._redis_failed = False
        _reset_recovery_state()
        logger.info("OTP Redis runtime recovered")
        return client


async def ensure_otp_store(*, force: bool = False):
    """Async boundary for the blocking Redis connect/ping probe."""
    existing = _existing_client()
    if existing is not None:
        return existing
    return await asyncio.to_thread(ensure_otp_store_sync, force=force)


def reset_recovery_state() -> None:
    """Test helper; production state is reset automatically after recovery."""
    _reset_recovery_state()
