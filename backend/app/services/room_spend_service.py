"""Сколько потрачено по комнате — одна формула на весь продукт.

Величину считали в двух местах по-разному:

* `/analytics/expenses-summary` — `max(смета-факт, расходы, чеки)`;
* `/analytics/budget-alerts`    — `max(смета-факт, чеки)`, **без расходов**.

Второе означало, что предупреждение о перерасходе слепо к основному источнику
трат. Проверено на живой базе: комната с планом 68 962 ₽ и потраченными
137 924 ₽ давала `total_spent = 0` и `over_pct = −100 %`, то есть алерт не
срабатывал никогда.

Почему именно `max`, а не сумма: чек проецируется в расход
(`budget_service.expense_from_receipt`), поэтому чеки — подмножество расходов,
и сложение считало бы их дважды. «Смета-факт» — вообще другая ось: фактическое
количество по смете, а не платёж. Наибольшее из трёх — осознанная защита от
двойного счёта, и она здесь сохранена.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoomSpend:
    plan: float
    estimate_fact: float
    receipts_spent: float
    expense_spent: float

    @property
    def total_spent(self) -> float:
        return round(max(self.estimate_fact, self.expense_spent, self.receipts_spent), 2)

    @property
    def over_pct(self) -> float:
        """Отклонение от плана в процентах; без плана сравнивать не с чем."""
        if not self.plan:
            return 0.0
        return round(self.total_spent / self.plan * 100 - 100, 1)


def room_spend(
    room_id: str,
    *,
    estimate_lines,
    receipts,
    expenses,
) -> RoomSpend:
    """Считает по уже загруженным строкам: запросы остаются у вызывающего."""
    lines = [line for line in estimate_lines if line.room_id == room_id]
    return RoomSpend(
        plan=round(sum(l.quantity_planned * l.unit_price for l in lines), 2),
        estimate_fact=round(sum(l.quantity_actual * l.unit_price for l in lines), 2),
        receipts_spent=round(sum(r.amount for r in receipts if r.room_id == room_id), 2),
        expense_spent=round(
            sum(e.amount for e in expenses if e.room_id == room_id and e.status == "confirmed"),
            2,
        ),
    )
