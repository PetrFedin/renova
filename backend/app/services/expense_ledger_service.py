"""Recalculate budget totals from the existing Expense ledger without re-hydrating sources."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import BudgetLine, Expense, Project


async def recalculate_existing_expense_facts(db: AsyncSession, project_id: str) -> None:
    """Preserve dispute/refund statuses while recomputing BudgetLine and Project facts."""
    from app.services import budget_service as budget

    await budget.sync_budget_lines_from_estimate(db, project_id)
    expenses = list(
        (
            await db.execute(
                select(Expense).where(
                    Expense.project_id == project_id,
                    Expense.status.in_(("confirmed", "pending_receipt")),
                )
            )
        ).scalars().all()
    )
    lines = list(
        (
            await db.execute(
                select(BudgetLine).where(BudgetLine.project_id == project_id)
            )
        ).scalars().all()
    )

    category_totals: dict[str, float] = {}
    for expense in expenses:
        category = (
            expense.category
            if expense.category in ("works", "materials", "delivery", "tools", "other")
            else "other"
        )
        category_totals[category] = category_totals.get(category, 0.0) + float(expense.amount or 0)

    for line in lines:
        if line.category == "reserve":
            line.actual_amount = 0
            continue
        if line.estimate_line_id:
            linked = [
                expense
                for expense in expenses
                if (expense.room_id and expense.room_id == line.room_id)
                or (expense.stage_id and expense.stage_id == line.stage_id)
            ]
            line.actual_amount = round(
                sum(float(expense.amount or 0) for expense in linked if expense.category == line.category),
                2,
            )
            continue
        line.actual_amount = round(category_totals.get(line.category, 0.0), 2)

    project = await db.get(Project, project_id)
    if project:
        project.budget_spent = round(
            sum(float(expense.amount or 0) for expense in expenses if expense.status == "confirmed"),
            2,
        )
    await db.flush()
