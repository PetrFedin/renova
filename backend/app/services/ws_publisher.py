"""Shared Redis publisher for WebSocket fan-out.

``ws._redis_publish`` opened a *new* Redis connection for every published
frame and closed it immediately afterwards:

    client = redis.from_url(url, decode_responses=True)
    try:
        await client.publish(channel, packed)
    finally:
        await client.aclose()

That is a TCP connect, a RESP handshake and a teardown per chat message and per
inbox badge update. Under any real load it is the dominant cost of sending a
message, and it makes connection count scale with message rate instead of with
replica count.

This module keeps one lazily-created client per process. redis-py's asyncio
client is a connection *pool*, so concurrent publishes multiplex over it and a
dropped connection is re-established by the pool rather than by the caller.
Publishing stays best-effort: local in-process delivery is authoritative for
the current replica, and the durable record of a chat message is the database
row, never the socket frame.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

_client = None
_lock = asyncio.Lock()
_disabled = False


async def _get_client():
    """Return the shared client, or None when Redis is not configured."""
    global _client, _disabled

    if _disabled:
        return None
    if _client is not None:
        return _client

    from app.core.config import settings

    url = (settings.redis_url or "").strip()
    if not url:
        _disabled = True
        return None

    async with _lock:
        if _client is not None:
            return _client
        try:
            import redis.asyncio as redis  # type: ignore
        except ImportError:
            logger.warning("redis package missing — cross-instance WS fanout disabled")
            _disabled = True
            return None
        _client = redis.from_url(url, decode_responses=True)
        return _client


async def publish(channel: str, packed: str) -> bool:
    """Best-effort cross-instance publish. Returns whether it was delivered."""
    client = await _get_client()
    if client is None:
        return False
    try:
        await client.publish(channel, packed)
        return True
    except Exception:
        # Fail open: the publishing replica has already delivered locally, and
        # the database row is the durable truth.
        logger.warning("ws redis publish failed channel=%s", channel, exc_info=True)
        return False


async def close() -> None:
    """Release the shared client (shutdown, and test isolation)."""
    global _client, _disabled

    client = _client
    _client = None
    _disabled = False
    if client is not None:
        try:
            await client.aclose()
        except Exception:
            logger.debug("ws redis publisher close failed", exc_info=True)
