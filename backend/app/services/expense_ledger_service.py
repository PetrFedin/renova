"""Reproject the already-recognized Expense ledger without source re-hydration.

This status-preserving path is used after refunds and disputes: never call
refresh_budget_facts here, as it could recreate a terminally reversed source.
The canonical projector creates explicit unallocated fact lines when no
EstimateLine exists, preventing valid costs from disappearing in drilldowns.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def recalculate_existing_expense_facts(db: AsyncSession, project_id: str) -> None:
    """Serialize and project active Expenses exactly once into budget facts."""
    from app.services import budget_service as budget
    from app.services.project_budget_lock import lock_project_budget_projection

    if not await lock_project_budget_projection(db, project_id):
        raise ValueError("project_not_found")

    # Does not call receipt/payment/purchase hydration. It may update estimate
    # line metadata, then uses the same one-expense-one-line allocator as the
    # canonical budget refresh, including synthetic unallocated rows.
    await budget.sync_budget_lines_from_estimate(db, project_id)
    await budget._reconcile_budget_line_actuals(db, project_id)
