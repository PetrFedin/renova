"""Hard-purge soft-deleted users after retention (P2.21)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import User, UserSession

logger = logging.getLogger("renova.purge")

RETENTION_DAYS = 30


async def purge_deleted_users(db: AsyncSession, *, older_than_days: int = RETENTION_DAYS) -> int:
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    rows = list(
        (
            await db.execute(
                select(User).where(User.deleted_at.is_not(None), User.deleted_at < cutoff)
            )
        ).scalars().all()
    )
    n = 0
    for user in rows:
        await db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        await db.delete(user)
        n += 1
    if n:
        await db.commit()
        logger.info("hard-purged %s soft-deleted user(s)", n)
    return n
