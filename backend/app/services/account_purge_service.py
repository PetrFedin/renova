"""Hard-purge soft-deleted users after retention (P2.21)."""
from __future__ import annotations

from app.core.timeutil import utc_now
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, PushToken, User, UserSession

logger = logging.getLogger("renova.purge")

RETENTION_DAYS = 30


async def purge_deleted_users(db: AsyncSession, *, older_than_days: int = RETENTION_DAYS) -> int:
    cutoff = utc_now() - timedelta(days=older_than_days)
    rows = list(
        (
            await db.execute(
                select(User).where(User.deleted_at.is_not(None), User.deleted_at < cutoff)
            )
        ).scalars().all()
    )
    n = 0
    for user in rows:
        # Проекты ссылаются на пользователя по FK: пока проект жив, строку не удаляем.
        still_referenced = (
            await db.execute(
                select(Project.id)
                .where(or_(Project.customer_id == user.id, Project.contractor_id == user.id))
                .limit(1)
            )
        ).first()
        if still_referenced:
            logger.info("purge skipped for %s: still referenced by a project", user.id)
            continue
        await db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        await db.execute(delete(PushToken).where(PushToken.user_id == user.id))
        await db.delete(user)
        n += 1
    if n:
        await db.commit()
        logger.info("hard-purged %s soft-deleted user(s)", n)
    return n
