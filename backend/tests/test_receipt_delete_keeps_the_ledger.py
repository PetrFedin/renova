"""Удаление чека снимает расходы с учёта, а не стирает их из истории.

Найдено разбором полноты жизненного цикла сущностей.

`delete_receipt_expenses` звала `db.delete(e)` — физическое удаление строк
`Expense`, привязанных к чеку. То же делала `_cleanup_receipt_orphans`.
Одно нажатие переписывало историю расходов без следа и без отмены.

Отдельно неприятно, что продукт сам себе противоречил: обычный путь
удаления расхода такие строки трогать **запрещает** —
`expense_integrity_service` бросает `expense_source_locked:receipt`, — а
через удаление чека они уничтожались.

Мягкое удаление даёт тот же итог в деньгах: `refresh_budget_facts` и все
денежные выборки берут только `confirmed` и `pending_receipt`.
"""
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LEGACY = (ROOT / "app" / "services" / "budget_service_legacy.py").read_text()
BUDGET = (ROOT / "app" / "services" / "budget_service.py").read_text()
EXPENSE_INTEGRITY = (ROOT / "app" / "services" / "expense_integrity_service.py").read_text()


def _block(source: str, start: str, end: str) -> str:
    return source.split(start)[1].split(end)[0]


def test_linked_expenses_are_not_destroyed_by_default():
    block = _block(LEGACY, "async def delete_receipt_expenses", "async def expense_from_receipt")
    assert 'e.status = "deleted"' in block, "расходы чека снова удаляются физически"
    assert "collapsing_duplicate: bool = False" in block, "умолчание должно быть мягким"


def test_physical_delete_is_reserved_for_collapsing_duplicates():
    """Ту же функцию зовёт фискальная дедупликация — там строка не история.

    Я сначала сделал мягким всё разом и сломал `test_fiscal_receipt_
    deduplication`: рядом с каждым чеком оставался снятый с учёта двойник.
    """
    block = _block(LEGACY, "async def delete_receipt_expenses", "async def expense_from_receipt")
    assert "if collapsing_duplicate:" in block
    assert "await db.delete(e)" in block

    dedup = (ROOT / "app" / "services" / "fiscal_receipt_dedup_service.py").read_text()
    assert "collapsing_duplicate=True" in dedup

    receipts = (ROOT / "app" / "services" / "receipt_integrity_service.py").read_text()
    # Удаление пользователем намерения не объявляет — значит мягкое.
    assert "collapsing_duplicate" not in receipts


def test_orphan_cleanup_stays_physical():
    """Сироты — артефакт создания чека, а не история.

    Мягчить их удаление я сначала попробовал и сломал фискальную
    дедупликацию: рядом с каждым чеком оставался снятый с учёта двойник,
    и `count(Expense)` переставал сходиться.
    """
    block = _block(LEGACY, "async def _cleanup_receipt_orphans", "async def ")
    assert "await db.delete(o)" in block


def test_money_still_leaves_the_budget():
    # Мягкое удаление обязано давать тот же итог: пересчёт берёт только
    # confirmed и pending_receipt.
    assert 'Expense.status.in_(("confirmed", "pending_receipt"))' in LEGACY


def test_removed_amount_is_still_reported():
    # Вызывающая сторона показывает сумму снятого — её терять нельзя.
    block = _block(LEGACY, "async def delete_receipt_expenses", "async def expense_from_receipt")
    assert 'if e.status == "confirmed":' in block
    assert "removed += e.amount" in block
    assert "return round(removed, 2)" in block


def test_dedupe_still_sees_soft_deleted_rows():
    """Снятые строки обязаны оставаться видимыми для дедупликации.

    Я сначала исключил их — и сломал `test_verified_receipt_cannot_resurrect_
    protected_expense`. Логика обратная той, что я предположил: если снятую
    строку не видеть, `expense_from_receipt` решит, что расхода нет, и заведёт
    новый `confirmed`. Именно так расход и воскресал бы.
    """
    block = _block(BUDGET, "async def _dedupe_linked_expenses", "async def expense_from_receipt")
    assert 'Expense.status != "deleted"' not in block


def test_normal_path_still_refuses_receipt_sourced_expenses():
    # Именно это противоречие и было: путь отказывался, а чек уничтожал.
    assert 'raise ValueError(f"expense_source_locked:{source}")' in EXPENSE_INTEGRITY
    assert '{"receipt", "payment", "purchase", "material_pick"}' in EXPENSE_INTEGRITY


def test_normal_path_soft_deletes_too():
    # Соглашение общее: снятие с учёта, а не стирание.
    assert 'expense.status = "deleted"' in EXPENSE_INTEGRITY


def test_confirmed_payment_still_locks_receipt_deletion():
    receipt_service = (ROOT / "app" / "services" / "receipt_integrity_service.py").read_text()
    assert 'raise ValueError("confirmed_payment_receipt_locked")' in receipt_service


@pytest.mark.asyncio
async def test_deleting_a_receipt_keeps_the_expense_row(db):
    from app.models.entities import Expense, Receipt
    from app.services.budget_service_legacy import delete_receipt_expenses
    from sqlalchemy import select

    receipt = Receipt(project_id="p1", amount=1500.0, fn="MANUAL", fns_verified=False)
    db.add(receipt)
    await db.flush()
    db.add(
        Expense(
            project_id="p1",
            receipt_id=receipt.id,
            amount=1500.0,
            status="confirmed",
            title="Плитка",
        )
    )
    await db.flush()

    removed = await delete_receipt_expenses(db, receipt.id, rec=receipt)
    assert removed == 1500.0

    rows = list((await db.execute(select(Expense).where(Expense.receipt_id == receipt.id))).scalars().all())
    assert len(rows) == 1, "строка расхода исчезла из истории"
    assert rows[0].status == "deleted"
    assert rows[0].amount == 1500.0, "сумма в истории должна остаться прежней"
