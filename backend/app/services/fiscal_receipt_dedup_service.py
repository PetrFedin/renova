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
    exclude_receipt_id: str | None = None,
) -> Receipt | None:
    """Return the canonical receipt while holding the project scan lock."""
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
    if exclude_receipt_id:
        query = query.where(Receipt.id != exclude_receipt_id)
    existing = (
        await db.execute(query.order_by(Receipt.created_at.asc(), Receipt.id.asc()).limit(1))
    ).scalar_one_or_none()
    if not existing:
        return None
    if round(float(existing.amount or 0), 2) != round(float(amount or 0), 2):
        raise ValueError("fiscal_receipt_identity_conflict")
    return existing


async def collapse_duplicate_scan_candidate(
    db: AsyncSession,
    *,
    project_id: str,
    receipt_id: str,
) -> str | None:
    """Remove an uncommitted duplicate Receipt/Expense and return canonical ID.

    All scan writers call this before commit. The project row lock makes the
    check safe across concurrent backend instances under READ COMMITTED.
    """
    candidate = await db.get(Receipt, receipt_id)
    if not candidate or candidate.project_id != project_id or candidate.fn == "MANUAL":
        return None
    existing = await find_existing_scan(
        db,
        project_id=project_id,
        fn=candidate.fn,
        fd=candidate.fd,
        qr_raw=candidate.qr_raw or "",
        amount=candidate.amount,
        exclude_receipt_id=candidate.id,
    )
    if not existing:
        return None

    from app.services import budget_service as budget

    await budget.delete_receipt_expenses(db, candidate.id, rec=candidate)
    await db.delete(candidate)
    await budget.refresh_budget_facts(db, project_id)
    await db.flush()
    return existing.id
