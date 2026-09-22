"""Снятый с учёта расход можно вернуть в бюджет.

Найдено разбором полноты жизненного цикла сущностей.

Расход нельзя создать напрямую — ручки нет, он появляется только из чека,
оплаты, закупки или подбора материала. Удаление при этом мягкое
(`status = "deleted"`), но восстановления не существовало: случайно
удалённый расход не возвращался никак.

Асимметрия хуже обычного пробела: удалить можно то, что нельзя создать
заново.
"""
import pathlib

import pytest
from sqlalchemy import select

from app.models.entities import Expense

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTES = (ROOT / "app" / "api" / "v1" / "expense_mutations.py").read_text()
SERVICE = (ROOT / "app" / "services" / "expense_integrity_service.py").read_text()


async def _seed(db, status: str = "confirmed") -> Expense:
    expense = Expense(
        project_id="p1",
        amount=2400.0,
        status=status,
        title="Грунтовка",
        category="materials",
    )
    db.add(expense)
    await db.flush()
    return expense


def test_route_exists_and_requires_write():
    assert '@router.post("/{expense_id}/restore")' in ROUTES
    block = ROUTES.split('@router.post("/{expense_id}/restore")')[1].split("@router.")[0]
    assert "write=True" in block


@pytest.mark.asyncio
async def test_deleted_expense_returns_to_the_budget(db):
    from app.services.expense_integrity_service import restore_expense

    expense = await _seed(db, status="deleted")
    await db.commit()

    result = await restore_expense(db, project_id="p1", expense_id=expense.id, actor_id="u1")
    assert result is not None
    assert result.changed is True
    assert result.expense.status == "confirmed"


@pytest.mark.asyncio
async def test_restore_is_not_an_error_on_a_live_expense(db):
    # Повтор не должен ломаться: строка уже в бюджете.
    from app.services.expense_integrity_service import restore_expense

    expense = await _seed(db, status="confirmed")
    await db.commit()

    result = await restore_expense(db, project_id="p1", expense_id=expense.id, actor_id="u1")
    assert result is not None
    assert result.changed is False
    assert result.replayed is True
    assert result.expense.status == "confirmed"


@pytest.mark.asyncio
async def test_restore_of_a_missing_expense_is_not_a_crash(db):
    from app.services.expense_integrity_service import restore_expense

    assert await restore_expense(db, project_id="p1", expense_id="нет-такого", actor_id="u1") is None


@pytest.mark.asyncio
async def test_restored_expense_is_not_duplicated(db):
    from app.services.expense_integrity_service import restore_expense

    expense = await _seed(db, status="deleted")
    await db.commit()
    await restore_expense(db, project_id="p1", expense_id=expense.id, actor_id="u1")

    rows = list((await db.execute(select(Expense).where(Expense.project_id == "p1"))).scalars().all())
    assert len(rows) == 1, "восстановление завело вторую строку вместо возврата прежней"
    assert rows[0].amount == 2400.0, "сумма при возврате изменилась"


def test_restore_returns_to_confirmed_not_pending():
    # `pending_receipt` означал бы, что чек ещё ждут, — это другая неправда.
    block = SERVICE.split("async def restore_expense")[1].split("async def delete_expense")[0]
    assert 'expense.status = "confirmed"' in block
    assert "pending_receipt" not in block.split('expense.status = "confirmed"')[1]


def test_restore_refreshes_the_budget():
    block = SERVICE.split("async def restore_expense")[1].split("async def delete_expense")[0]
    assert "refresh_budget_facts" in block, "бюджет не пересчитан — возврат не отразится в деньгах"


def test_restore_leaves_a_trace():
    block = SERVICE.split("async def restore_expense")[1].split("async def delete_expense")[0]
    assert '"kind": "ExpenseRestored"' in block


def test_delete_still_works_as_before():
    # Проверка не должна проходить оттого, что удаление сломалось.
    block = SERVICE.split("async def delete_expense")[1]
    assert 'expense.status = "deleted"' in block
    assert 'raise ValueError(f"expense_source_locked:{source}")' in block
