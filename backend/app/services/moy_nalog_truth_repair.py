"""Idempotent repair of legacy «Мой налог» connection flags."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import User
from app.services import moy_nalog_oauth as oauth


async def repair_legacy_moy_nalog_truth(db: AsyncSession) -> dict[str, int]:
    """Clear linked flags that have no active encrypted OAuth token.

    Before the durable token vault existed, demo/admin flows could write
    linked=True. New connected rows are preserved only when their Redis token
    decrypts and passes the current schema contract.
    """
    users = list(
        (
            await db.execute(
                select(User).where(
                    or_(
                        User.moy_nalog_linked.is_(True),
                        User.moy_nalog_status.in_(("admin_enabled", "authorization_started", "connected")),
                    )
                )
            )
        ).scalars().all()
    )
    repaired = 0
    preserved = 0
    for user in users:
        status = str(user.moy_nalog_status or "not_connected")
        active = False
        if status == "connected" and oauth.oauth_ready():
            active = await oauth.connection_active(user.id)
        if status == "connected" and active:
            if not user.moy_nalog_linked:
                user.moy_nalog_linked = True
                repaired += 1
            preserved += 1
            continue
        next_status = "token_expired" if status == "connected" else "not_connected"
        if user.moy_nalog_linked or status != next_status:
            user.moy_nalog_linked = False
            user.moy_nalog_status = next_status
            repaired += 1
    await db.flush()
    return {"users_repaired": repaired, "connections_preserved": preserved}
