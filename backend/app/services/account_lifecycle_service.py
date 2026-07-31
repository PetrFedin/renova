"""Atomic account lifecycle transitions."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import User
from app.services import session_service

RETENTION_DAYS = 30


def anonymized_phone(user_id: str) -> str:
    """Return a deterministic, schema-safe replacement for a deleted phone."""
    return f"deleted-{user_id[:8]}"


async def soft_delete_account(db: AsyncSession, user: User) -> dict[str, object]:
    """Anonymize the account and revoke refresh/access sessions in one transaction."""
    now = utc_now()
    if user.deleted_at is not None:
        deleted_at = user.deleted_at
        return {
            "ok": True,
            "soft_deleted": True,
            "already_deleted": True,
            "revoked_sessions": 0,
            "retention_until": (deleted_at + timedelta(days=RETENTION_DAYS)).isoformat() + "Z",
        }

    user.deletion_requested_at = now
    user.deleted_at = now
    user.tokens_invalid_before = now
    user.phone = anonymized_phone(user.id)
    user.full_name = "Deleted"
    user.inn = None
    user.moy_nalog_linked = False
    user.moy_nalog_status = "revoked"

    try:
        revoked = await session_service.revoke_all_user_sessions(
            db,
            user.id,
            commit=False,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return {
        "ok": True,
        "soft_deleted": True,
        "already_deleted": False,
        "revoked_sessions": revoked,
        "retention_until": (now + timedelta(days=RETENTION_DAYS)).isoformat() + "Z",
    }
