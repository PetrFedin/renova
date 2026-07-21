"""Audit успешных/неуспешных входов (identity layer)."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AuditLog


async def log_auth_event(
    db: AsyncSession,
    *,
    user_id: str | None,
    path: str,
    status_code: int,
    note: str | None = None,
) -> None:
    try:
        db.add(AuditLog(
            user_id=user_id,
            method="AUTH",
            path=(path + (f"|{note}" if note else ""))[:512],
            status_code=status_code,
        ))
        await db.commit()
    except Exception:
        await db.rollback()
