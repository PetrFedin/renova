"""Project-scoped, source-aware and replay-safe direct Expense mutations."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Room, Stage

_VALID_CATEGORIES = {"works", "materials", "delivery", "tools", "other"}
_BANK_MARKER_PREFIX = "bank_statement:v1:"


@dataclass(frozen=True)
class ExpenseMutation:
    expense: Expense
    changed: bool
    replayed: bool = False


def expense_source(expense: Expense) -> str:
    if expense.receipt_id:
        return "receipt"
    if expense.payment_id:
        return "payment"
    if expense.purchase_id:
        return "purchase"
    if expense.material_pick_id:
        return "material_pick"
    if (expense.comment or "").startswith(_BANK_MARKER_PREFIX):
        return "bank_statement"
    return "manual"


async def get_expense(
    db: AsyncSession,
    *,
    project_id: str,
    expense_id: str,
    for_update: bool = False,
) -> Expense | None:
    query = select(Expense).where(
        Expense.id == expense_id,
        Expense.project_id == project_id,
    )
    if for_update:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def _resolve_room_id(
    db: AsyncSession,
    *,
    project_id: str,
    room_id: str | None,
) -> str | None:
    if not room_id:
        return None
    value = (
        await db.execute(
            select(Room.id).where(Room.id == room_id, Room.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not value:
        raise ValueError("expense_room_not_found")
    return str(value)


async def _resolve_stage_id(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str | None,
) -> str | None:
    if not stage_id:
        return None
    value = (
        await db.execute(
            select(Stage.id).where(Stage.id == stage_id, Stage.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not value:
        raise ValueError("expense_stage_not_found")
    return str(value)


def _is_same_number(left: float, right: float) -> bool:
    return round(float(left or 0), 2) == round(float(right or 0), 2)


async def patch_expense(
    db: AsyncSession,
    *,
    project_id: str,
    expense_id: str,
    actor_id: str,
    amount_supplied: bool,
    amount: float | None,
    title_supplied: bool,
    title: str | None,
    category_supplied: bool,
    category: str | None,
    room_id_supplied: bool,
    room_id: str | None,
    stage_id_supplied: bool,
    stage_id: str | None,
) -> ExpenseMutation | None:
    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    expense = await get_expense(
        db,
        project_id=project_id,
        expense_id=expense_id,
        for_update=True,
    )
    if not expense or expense.status == "deleted":
        return None

    source = expense_source(expense)
    if source in {"receipt", "payment", "purchase", "material_pick"}:
        raise ValueError(f"expense_source_locked:{source}")

    changed = False
    if amount_supplied:
        if amount is None or amount <= 0:
            raise ValueError("expense_amount_invalid")
        normalized_amount = round(float(amount), 2)
        if source == "bank_statement" and not _is_same_number(expense.amount, normalized_amount):
            raise ValueError("bank_expense_amount_immutable")
        if not _is_same_number(expense.amount, normalized_amount):
            expense.amount = normalized_amount
            changed = True

    if title_supplied:
        normalized_title = (title or "").strip()
        if not normalized_title:
            raise ValueError("expense_title_required")
        if source == "bank_statement" and normalized_title != expense.title:
            raise ValueError("bank_expense_title_immutable")
        if normalized_title != expense.title:
            expense.title = normalized_title[:255]
            changed = True

    if category_supplied:
        if category not in _VALID_CATEGORIES:
            raise ValueError("expense_category_invalid")
        if category != expense.category:
            expense.category = str(category)
            changed = True

    if room_id_supplied:
        resolved_room_id = await _resolve_room_id(
            db,
            project_id=project_id,
            room_id=room_id,
        )
        if resolved_room_id != expense.room_id:
            expense.room_id = resolved_room_id
            changed = True

    if stage_id_supplied:
        resolved_stage_id = await _resolve_stage_id(
            db,
            project_id=project_id,
            stage_id=stage_id,
        )
        if resolved_stage_id != expense.stage_id:
            expense.stage_id = resolved_stage_id
            changed = True

    if changed:
        await db.flush()
        await budget.refresh_budget_facts(db, project_id)
        await outbox.enqueue(
            db,
            aggregate_type="expense",
            aggregate_id=expense.id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project_id,
                "user_id": actor_id,
                "kind": "ExpenseUpdated",
                "title": f"Расход обновлён: {expense.title}",
                "body": f"{expense.amount} ₽ · {expense.category}",
                "room_id": expense.room_id,
                "link_path": "/(customer)/(tabs)/budget?tab=expenses",
            },
        )
    await db.commit()
    return ExpenseMutation(expense=expense, changed=changed, replayed=not changed)


async def delete_expense(
    db: AsyncSession,
    *,
    project_id: str,
    expense_id: str,
    actor_id: str,
) -> ExpenseMutation | None:
    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    expense = await get_expense(
        db,
        project_id=project_id,
        expense_id=expense_id,
        for_update=True,
    )
    if not expense:
        return None
    if expense.status == "deleted":
        await db.commit()
        return ExpenseMutation(expense=expense, changed=False, replayed=True)

    source = expense_source(expense)
    if source in {"receipt", "payment", "purchase", "material_pick"}:
        raise ValueError(f"expense_source_locked:{source}")

    expense.status = "deleted"
    await db.flush()
    await budget.refresh_budget_facts(db, project_id)
    await outbox.enqueue(
        db,
        aggregate_type="expense",
        aggregate_id=expense.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project_id,
            "user_id": actor_id,
            "kind": "ExpenseRemoved",
            "title": f"Расход удалён: {expense.title}",
            "body": f"{expense.amount} ₽",
            "room_id": expense.room_id,
            "link_path": "/(customer)/(tabs)/budget?tab=expenses",
        },
    )
    await db.commit()
    return ExpenseMutation(expense=expense, changed=True)
