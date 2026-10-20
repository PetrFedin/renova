"""Project-scoped transaction fence for financial budget projections.

Payment writers acquire their Payment row lock first, then this Project lock,
then edit linked Expenses and BudgetLines. Readers that rehydrate or project
budget facts acquire this same Project lock *before* touching financial sources.
PostgreSQL READ COMMITTED refreshes the ledger view after the preceding holder
commits. The lock lasts until the caller commits or rolls back; this module
never commits on its own.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project


async def lock_project_budget_projection(
    db: AsyncSession, project_id: str,
) -> Project | None:
    """Serialize cross-payment budget writers on the authoritative Project row.

    `FOR UPDATE` is enforced by PostgreSQL (the production database); SQLite
    tests cannot establish the corresponding concurrent transaction guarantee.
    Never silently bypass failed lock acquisition or open a second session.
    """
    return (
        await db.execute(
            select(Project).where(Project.id == project_id).with_for_update()
        )
    ).scalar_one_or_none()
