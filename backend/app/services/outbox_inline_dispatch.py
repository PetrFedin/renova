"""Observable inline acceleration for already-durable outbox events."""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import outbox_service

logger = logging.getLogger("renova.outbox.inline")


async def dispatch_best_effort(
    db: AsyncSession,
    *,
    source: str,
    limit: int = 10,
) -> int:
    """Try immediate delivery without turning a durable write into a false failure.

    The business transaction and outbox rows must already be committed. Unexpected
    inline delivery failures are logged and left for the background worker. Task
    cancellation remains observable and is never swallowed.
    """
    try:
        return await outbox_service.dispatch_pending(db, limit=limit)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - durable worker will retry the retained rows
        await db.rollback()
        logger.exception(
            "inline outbox dispatch failed source=%s; durable rows retained",
            source,
        )
        return 0
