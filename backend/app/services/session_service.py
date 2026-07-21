"""User sessions + refresh token rotation."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_refresh_token, mint_refresh_token
from app.models.entities import UserSession, _uuid


def _refresh_days() -> int:
    return max(1, int(getattr(settings, "refresh_token_expire_days", 30)))


async def create_session(
    db: AsyncSession,
    user_id: str,
    *,
    device_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[UserSession, str]:
    raw = mint_refresh_token()
    now = utc_now()
    row = UserSession(
        id=_uuid(),
        user_id=user_id,
        refresh_token_hash=hash_refresh_token(raw),
        device_id=device_id,
        created_at=now,
        expires_at=now + timedelta(days=_refresh_days()),
        last_used_at=now,
        ip=ip,
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row, raw


async def rotate_session(db: AsyncSession, refresh_token: str) -> tuple[UserSession, str] | None:
    """Validate refresh, revoke old, mint new (rotation)."""
    th = hash_refresh_token(refresh_token)
    result = await db.execute(select(UserSession).where(UserSession.refresh_token_hash == th))
    sess = result.scalar_one_or_none()
    if not sess or sess.revoked_at is not None:
        return None
    if sess.expires_at < utc_now():
        sess.revoked_at = utc_now()
        await db.commit()
        return None
    sess.revoked_at = utc_now()
    await db.commit()
    return await create_session(
        db,
        sess.user_id,
        device_id=sess.device_id,
        ip=sess.ip,
        user_agent=sess.user_agent,
    )


async def revoke_session(db: AsyncSession, refresh_token: str) -> bool:
    th = hash_refresh_token(refresh_token)
    result = await db.execute(select(UserSession).where(UserSession.refresh_token_hash == th))
    sess = result.scalar_one_or_none()
    if not sess or sess.revoked_at:
        return False
    sess.revoked_at = utc_now()
    await db.commit()
    return True


async def revoke_all_user_sessions(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    )
    n = 0
    now = utc_now()
    for sess in result.scalars().all():
        sess.revoked_at = now
        n += 1
    if n:
        await db.commit()
    return n
