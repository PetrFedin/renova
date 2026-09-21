"""Предупреждение о перерасходе по комнате должно видеть расходы.

Величину «потрачено по комнате» считали в двух местах по-разному:
`/analytics/expenses-summary` брал `max(смета-факт, расходы, чеки)`, а
`/analytics/budget-alerts` — `max(смета-факт, чеки)`, без расходов.

Проверено на живой базе: комната с планом 68 962 ₽, где расходами потрачено
137 924 ₽ (двести процентов плана), давала в алертах `total_spent = 0` и
`over_pct = −100 %`. То есть предупреждение о перерасходе не срабатывало
никогда — оно было слепо к основному источнику трат.

`max`, а не сумма — намеренно: чек проецируется в расход, поэтому чеки уже
входят в расходы, и сложение считало бы их дважды.
"""
import pytest

from app.services import room_spend_service


class _Line:
    def __init__(self, room_id, planned, price, actual=0.0):
        self.room_id = room_id
        self.quantity_planned = planned
        self.unit_price = price
        self.quantity_actual = actual


class _Money:
    def __init__(self, room_id, amount, status="confirmed"):
        self.room_id = room_id
        self.amount = amount
        self.status = status


ROOM = "room-1"


def test_expenses_are_counted():
    # Ровно случай с живой базы: план есть, потрачено расходами вдвое больше.
    spend = room_spend_service.room_spend(
        ROOM,
        estimate_lines=[_Line(ROOM, 1, 68962.2)],
        receipts=[],
        expenses=[_Money(ROOM, 137924.4)],
    )
    assert spend.expense_spent == 137924.4
    assert spend.total_spent == 137924.4
    assert spend.over_pct == 100.0, "перерасход вдвое должен читаться как +100 %"


def test_receipts_are_not_added_on_top_of_expenses():
    # Чек проецируется в расход: сложение посчитало бы деньги дважды.
    spend = room_spend_service.room_spend(
        ROOM,
        estimate_lines=[_Line(ROOM, 1, 10000)],
        receipts=[_Money(ROOM, 5000)],
        expenses=[_Money(ROOM, 5000)],
    )
    assert spend.total_spent == 5000.0


def test_unconfirmed_expense_is_not_spent_yet():
    spend = room_spend_service.room_spend(
        ROOM,
        estimate_lines=[_Line(ROOM, 1, 10000)],
        receipts=[],
        expenses=[_Money(ROOM, 7000, status="pending_receipt")],
    )
    assert spend.expense_spent == 0.0


def test_estimate_fact_still_counts_when_it_is_the_largest():
    # Прежнее поведение сводки расходов: смета-факт остаётся источником.
    spend = room_spend_service.room_spend(
        ROOM,
        estimate_lines=[_Line(ROOM, 1, 10000, actual=1.2)],
        receipts=[_Money(ROOM, 3000)],
        expenses=[_Money(ROOM, 4000)],
    )
    assert spend.estimate_fact == 12000.0
    assert spend.total_spent == 12000.0


def test_other_rooms_do_not_leak_in():
    spend = room_spend_service.room_spend(
        ROOM,
        estimate_lines=[_Line(ROOM, 1, 1000), _Line("room-2", 1, 999999)],
        receipts=[_Money("room-2", 888888)],
        expenses=[_Money("room-2", 777777)],
    )
    assert spend.plan == 1000.0
    assert spend.total_spent == 0.0


def test_room_without_plan_does_not_divide_by_zero():
    spend = room_spend_service.room_spend(
        ROOM, estimate_lines=[], receipts=[], expenses=[_Money(ROOM, 5000)],
    )
    assert spend.plan == 0.0
    assert spend.over_pct == 0.0


def test_both_endpoints_use_the_same_helper():
    from pathlib import Path

    from app.api.v1 import analytics

    source = Path(analytics.__file__).read_text(encoding="utf-8")
    assert source.count("room_spend_service.room_spend(") == 2, (
        "одна из ручек снова считает потраченное по комнате сама"
    )
    assert "max(fact, receipts_spent)" not in source
