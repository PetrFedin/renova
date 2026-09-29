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

    Доставка идёт в ОТДЕЛЬНОЙ сессии. Раньше она работала в сессии самого
    HTTP-запроса, и любой сбой доставки делал на ней ``rollback``: уже
    загруженные объекты хендлера истекали, а следующее обращение к ним падало
    ``MissingGreenlet``. Одна неотправляемая строка в очереди превращалась в
    HTTP 500 на постороннем действии, которое к тому моменту уже прошло.

    Сессия берётся на движке ВЫЗЫВАЮЩЕГО, а не на глобальном ``SessionLocal``:
    база должна остаться той же самой, отдельной обязана быть только
    транзакция. Иначе в любом контексте, где сессия привязана к другому
    движку, доставка уходила бы мимо.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    bind = db.bind
    if bind is None:  # сессия без явного движка — доставку доберёт воркер
        from app.db.session import SessionLocal

        make_session = SessionLocal
    else:
        make_session = async_sessionmaker(bind, expire_on_commit=False)

    try:
        async with make_session() as delivery_db:
            try:
                return await outbox_service.dispatch_pending(delivery_db, limit=limit)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - durable worker will retry the retained rows
                await delivery_db.rollback()
                raise
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - durable worker will retry the retained rows
        logger.exception(
            "inline outbox dispatch failed source=%s; durable rows retained",
            source,
        )
        return 0
