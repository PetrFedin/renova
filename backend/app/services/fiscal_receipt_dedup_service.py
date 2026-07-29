"""Serialize fiscal receipt scans per project and resolve canonical duplicates."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Receipt


def normalize_qr_raw(qr_raw: str) -> str:
    return "".join((qr_raw or "").strip().split())[:500]


async def lock_project_scan(db: AsyncSession, *, project_id: str) -> None:
    query = select(Project.id).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    project = (await db.execute(query.limit(1))).scalar_one_or_none()
    if not project:
        raise ValueError("receipt_project_not_found")


async def find_existing_scan(
    db: AsyncSession,
    *,
    project_id: str,
    fn: str | None,
    fd: str | None,
    qr_raw: str,
    amount: float,
) -> Receipt | None:
    """Return the canonical receipt while holding the project scan lock.

    The project lock serializes concurrent scans before insert, so two app
    instances cannot both conclude that the same fiscal document is absent.
    """
    await lock_project_scan(db, project_id=project_id)
    normalized_raw = normalize_qr_raw(qr_raw)
    if fn and fd:
        query = select(Receipt).where(
            Receipt.project_id == project_id,
            Receipt.fn == str(fn),
            Receipt.fd == str(fd),
        )
    else:
        query = select(Receipt).where(
            Receipt.project_id == project_id,
            Receipt.qr_raw == normalized_raw,
        )
    existing = (
        await db.execute(query.order_by(Receipt.created_at.asc(), Receipt.id.asc()).limit(1))
    ).scalar_one_or_none()
    if not existing:
        return None
    if round(float(existing.amount or 0), 2) != round(float(amount or 0), 2):
        raise ValueError("fiscal_receipt_identity_conflict")
    return existing
