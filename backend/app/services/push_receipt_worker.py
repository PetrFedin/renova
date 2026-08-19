"""Background reconciler for durable Expo push receipts."""
from __future__ import annotations

import asyncio
import logging
import socket
import uuid

from app.db.session import SessionLocal
from app.services.push_receipt_service import reconcile_pending

logger = logging.getLogger("renova.push.receipt_worker")


def _worker_id() -> str:
    return f"{socket.gethostname()}:{uuid.uuid4().hex[:12]}"


async def push_receipt_worker_loop(
    stop: asyncio.Event,
    *,
    interval_sec: float = 60.0,
) -> None:
    worker_id = _worker_id()
    while not stop.is_set():
        try:
            async with SessionLocal() as db:
                metrics = await reconcile_pending(db, worker_id=worker_id)
                if any(metrics.values()):
                    logger.info("push receipt reconciliation tick", extra=metrics)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("push receipt worker tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(float(interval_sec), 1.0))
        except asyncio.TimeoutError:
            pass
