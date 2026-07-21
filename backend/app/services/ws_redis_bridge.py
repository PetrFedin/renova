"""Redis pub/sub bridge for multi-instance WebSocket fanout.

Publish path: broadcast() → local deliver + PUBLISH with instance_id.
Subscribe path: ignore own instance_id, deliver to local rooms only (no re-publish).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# Stable per process — skip echo of our own publishes
INSTANCE_ID = uuid.uuid4().hex[:12]

CHANNEL_THREAD_PREFIX = "renova:ws:thread:"
CHANNEL_INBOX_PREFIX = "renova:ws:inbox:"
# Pattern subscribe: renova:ws:*
PATTERN = "renova:ws:*"


def pack_message(payload: dict[str, Any] | str) -> str:
    """Wrap payload JSON with instance_id for loop prevention."""
    if isinstance(payload, str):
        try:
            body = json.loads(payload)
        except json.JSONDecodeError:
            body = {"raw": payload}
    else:
        body = payload
    return json.dumps({"_from": INSTANCE_ID, "body": body}, ensure_ascii=False)


def unpack_message(raw: str) -> tuple[str | None, str]:
    """Return (from_id, body_json_str). body_json_str is what clients expect."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, raw
    if isinstance(data, dict) and "_from" in data and "body" in data:
        body = data["body"]
        body_str = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
        return str(data["_from"]), body_str
    # Legacy plain payload
    return None, raw


async def deliver_local_thread(thread_id: str, msg: str) -> None:
    from app.api.v1 import ws as ws_mod

    for sock in list(ws_mod.rooms.get(thread_id, [])):
        try:
            await sock.send_text(msg)
        except Exception:
            ws_mod.rooms[thread_id].discard(sock)


async def deliver_local_inbox(user_id: str, msg: str) -> None:
    from app.api.v1 import ws as ws_mod

    if not user_id:
        return
    for sock in list(ws_mod.inbox_rooms.get(user_id, [])):
        try:
            await sock.send_text(msg)
        except Exception:
            ws_mod.inbox_rooms[user_id].discard(sock)


async def handle_redis_message(channel: str, raw: str) -> None:
    from_id, body = unpack_message(raw)
    if from_id == INSTANCE_ID:
        return  # echo of our publish
    if channel.startswith(CHANNEL_THREAD_PREFIX):
        thread_id = channel[len(CHANNEL_THREAD_PREFIX) :]
        await deliver_local_thread(thread_id, body)
    elif channel.startswith(CHANNEL_INBOX_PREFIX):
        user_id = channel[len(CHANNEL_INBOX_PREFIX) :]
        await deliver_local_inbox(user_id, body)


async def redis_subscriber_loop(stop: asyncio.Event) -> None:
    """Long-running PSUBSCRIBE; no-op when REDIS_URL empty."""
    from app.core.config import settings

    url = (settings.redis_url or "").strip()
    if not url:
        logger.info("ws redis bridge skipped (REDIS_URL empty)")
        await stop.wait()
        return

    try:
        import redis.asyncio as redis  # type: ignore
    except ImportError:
        logger.warning("redis package missing — WS multi-instance bridge disabled")
        await stop.wait()
        return

    backoff = 1.0
    while not stop.is_set():
        client = None
        pubsub = None
        try:
            client = redis.from_url(url, decode_responses=True)
            pubsub = client.pubsub()
            await pubsub.psubscribe(PATTERN)
            logger.info("ws redis bridge subscribed pattern=%s instance=%s", PATTERN, INSTANCE_ID)
            backoff = 1.0
            while not stop.is_set():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not msg:
                    await asyncio.sleep(0.05)
                    continue
                if msg.get("type") not in ("pmessage", "message"):
                    continue
                channel = msg.get("channel") or msg.get("pattern") or ""
                # pmessage: channel is actual channel name
                if msg.get("type") == "pmessage":
                    channel = msg.get("channel") or ""
                data = msg.get("data")
                if not isinstance(channel, str) or not isinstance(data, str):
                    continue
                try:
                    await handle_redis_message(channel, data)
                except Exception:
                    logger.exception("ws redis deliver failed channel=%s", channel)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ws redis bridge reconnect in %.1fs", backoff)
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
                break
            except asyncio.TimeoutError:
                backoff = min(backoff * 2, 30.0)
        finally:
            try:
                if pubsub is not None:
                    await pubsub.aclose()
            except Exception:
                pass
            try:
                if client is not None:
                    await client.aclose()
            except Exception:
                pass
