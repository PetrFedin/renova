"""Background dispatcher for domain_outbox (P1.16)."""
from __future__ import annotations

import asyncio
import logging

from app.db.session import SessionLocal
from app.services import outbox_service as outbox

logger = logging.getLogger("renova.outbox.worker")


async def outbox_worker_loop(stop: asyncio.Event, *, interval_sec: float = 15.0) -> None:
    while not stop.is_set():
        try:
            async with SessionLocal() as db:
                n = await outbox.dispatch_pending(db, limit=50)
                if n:
                    logger.info("outbox dispatched %s row(s)", n)
        except Exception:
            logger.exception("outbox worker tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_sec)
        except asyncio.TimeoutError:
            pass
