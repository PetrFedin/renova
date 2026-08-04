"""User sessions + atomic refresh-token rotation."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_refresh_token, mint_refresh_token
from app.core.timeutil import utc_now
from app.models.entities import UserSession, _uuid


def _refresh_days() -> int:
    return max(1, int(getattr(settings, "refresh_token_expire_days", 30)))


def _new_session(
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
    return row, raw


async def create_session(
    db: AsyncSession,
    user_id: str,
    *,
    device_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    commit: bool = True,
) -> tuple[UserSession, str]:
    """Create a refresh session, optionally inside the caller unit of work."""
    row, raw = _new_session(
        user_id,
        device_id=device_id,
        ip=ip,
        user_agent=user_agent,
    )
    db.add(row)
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(row)
    return row, raw


async def rotate_session(db: AsyncSession, refresh_token: str) -> tuple[UserSession, str] | None:
    """Atomically claim one refresh token and create exactly one replacement."""
    token_hash = hash_refresh_token(refresh_token)
    now = utc_now()
    claimed = await db.execute(
        update(UserSession)
        .where(
            UserSession.refresh_token_hash == token_hash,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=now, last_used_at=now)
        .returning(
            UserSession.user_id,
            UserSession.device_id,
            UserSession.ip,
            UserSession.user_agent,
            UserSession.expires_at,
        )
    )
    row = claimed.first()
    if row is None:
        await db.rollback()
        return None

    user_id, device_id, ip, user_agent, expires_at = row
    if expires_at < now:
        await db.commit()
        return None

    try:
        replacement, raw = _new_session(
            user_id,
            device_id=device_id,
            ip=ip,
            user_agent=user_agent,
        )
        db.add(replacement)
        await db.flush()
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(replacement)
    return replacement, raw


async def revoke_session(db: AsyncSession, refresh_token: str) -> bool:
    token_hash = hash_refresh_token(refresh_token)
    result = await db.execute(
        update(UserSession)
        .where(
            UserSession.refresh_token_hash == token_hash,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now())
        .returning(UserSession.id)
    )
    revoked = result.first() is not None
    if revoked:
        await db.commit()
    else:
        await db.rollback()
    return revoked


async def revoke_all_user_sessions(
    db: AsyncSession,
    user_id: str,
    *,
    commit: bool = True,
) -> int:
    """Revoke every active refresh session, optionally inside the caller transaction."""
    result = await db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now())
        .returning(UserSession.id)
    )
    revoked_ids = result.scalars().all()
    if commit:
        await db.commit()
    return len(revoked_ids)
