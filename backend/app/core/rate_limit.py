"""Shared rate limiting primitives for public API traffic.

Staging and production use Redis as the authoritative quota store. Development
and test keep deterministic in-process quotas unless a Redis client is injected
explicitly (for integration tests). Deployed environments never fall back to
process-local state because that would silently multiply quota by replica count.
"""
from __future__ import annotations

import hashlib
import math
import threading
import time
from dataclasses import dataclass

from redis.asyncio import Redis

from app.core.config import settings

_WINDOW_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
"""


class RateLimitBackendUnavailable(RuntimeError):
    """Raised when a deployed environment cannot use its shared quota store."""


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after_seconds: int


def rate_limit_storage_key(prefix: str, identity: str) -> str:
    """Build a privacy-safe Redis key without exposing user ids or IPs."""
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return f"renova:rate-limit:{prefix}:{digest}"


class SharedRateLimiter:
    def __init__(self, redis_client: Redis | None = None) -> None:
        self._redis = redis_client
        self._owns_redis = False
        self._local_lock = threading.Lock()
        self._local_windows: dict[str, tuple[int, float]] = {}

    @staticmethod
    def _deployed() -> bool:
        return settings.normalized_environment in {"staging", "production"}

    def _client(self) -> Redis | None:
        if self._redis is not None:
            return self._redis
        if not self._deployed():
            return None
        redis_url = (settings.redis_url or "").strip()
        if not redis_url:
            return None
        self._redis = Redis.from_url(redis_url, decode_responses=True)
        self._owns_redis = True
        return self._redis

    async def _local_check(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: float,
    ) -> RateLimitDecision:
        now = time.monotonic()
        with self._local_lock:
            count, expires_at = self._local_windows.get(key, (0, now + window_seconds))
            if now >= expires_at:
                count, expires_at = 0, now + window_seconds
            count += 1
            self._local_windows[key] = (count, expires_at)
            retry_after = max(1, math.ceil(expires_at - now))
            return RateLimitDecision(
                allowed=count <= limit,
                remaining=max(0, limit - count),
                retry_after_seconds=retry_after,
            )

    async def check(
        self,
        prefix: str,
        identity: str,
        *,
        limit: int,
        window_seconds: float = 60,
    ) -> RateLimitDecision:
        if limit <= 0:
            raise ValueError("rate limit must be positive")
        if window_seconds <= 0:
            raise ValueError("rate limit window must be positive")

        key = rate_limit_storage_key(prefix, identity)
        client = self._client()
        if client is None:
            if self._deployed():
                raise RateLimitBackendUnavailable("shared rate-limit Redis is not configured")
            return await self._local_check(key, limit=limit, window_seconds=window_seconds)

        window_ms = max(1, math.ceil(window_seconds * 1000))
        try:
            result = await client.eval(_WINDOW_SCRIPT, 1, key, window_ms)
            count, ttl_ms = int(result[0]), int(result[1])
        except Exception as exc:
            if self._deployed():
                raise RateLimitBackendUnavailable("shared rate-limit Redis is unavailable") from exc
            return await self._local_check(key, limit=limit, window_seconds=window_seconds)

        retry_after = max(1, math.ceil(max(1, ttl_ms) / 1000))
        return RateLimitDecision(
            allowed=count <= limit,
            remaining=max(0, limit - count),
            retry_after_seconds=retry_after,
        )

    async def ping(self) -> None:
        """Validate shared quota storage before serving deployed traffic."""
        if not self._deployed():
            return
        client = self._client()
        if client is None:
            raise RateLimitBackendUnavailable("shared rate-limit Redis is not configured")
        try:
            await client.ping()
        except Exception as exc:
            raise RateLimitBackendUnavailable("shared rate-limit Redis is unavailable") from exc

    async def close(self) -> None:
        if self._redis is not None and self._owns_redis:
            await self._redis.aclose()
        self._redis = None
        self._owns_redis = False


rate_limiter = SharedRateLimiter()
