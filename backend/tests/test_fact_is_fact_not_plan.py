"""Факт — это то, что записано, а не план.

`material_stats` и `/analytics` считали факт так:

    (l.quantity_actual or l.quantity_planned) * l.unit_price

то есть при пустом факте подставляли план. Заказчик видел «материалы: факт
112 465,80 ₽» при нулевых расходах, а отклонение всегда выходило нулевым —
сигнал перерасхода не мог сработать в принципе, пока факт не станет БОЛЬШЕ
плана хотя бы по одной строке.

Отдельно важно различать «уложились ровно» и «факт ещё не вносили»: и то и
другое давало бы ноль. Поэтому при пустом факте отклонение — None, а не число:
«−100 %» читалось бы как провал, хотя означает лишь отсутствие данных.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.models.entities import LineType
from app.services.estimate_service import material_stats


def _line(planned: float, actual: float | None, price: float = 100.0):
    return SimpleNamespace(
        line_type=LineType.material,
        quantity_planned=planned,
        quantity_actual=actual,
        unit_price=price,
    )


def test_an_untouched_estimate_has_no_fact():
    stats = material_stats([_line(10, None), _line(5, None)])

    assert stats["actual"] == 0, "план подставлен вместо пустого факта"
    assert stats["planned"] == 1500
    assert stats["overrun_percent"] is None, (
        "отклонение посчитано там, где считать не от чего"
    )
    assert stats["lines_with_fact"] == 0
    assert stats["lines_total"] == 2


def test_a_partial_fact_counts_only_what_is_recorded():
    stats = material_stats([_line(10, 12), _line(5, None)])

    assert stats["actual"] == 1200, "в факт попала строка без факта"
    assert stats["lines_with_fact"] == 1
    assert stats["overrun_percent"] == -20.0


def test_an_overrun_is_visible():
    """Ради этого сигнал и нужен."""
    stats = material_stats([_line(10, 14), _line(5, 6)])

    assert stats["actual"] == 2000
    assert stats["overrun_percent"] == 33.3
    assert stats["lines_with_fact"] == 2


def test_exactly_on_plan_is_not_the_same_as_no_data():
    """Оба случая раньше давали ноль и были неотличимы."""
    on_plan = material_stats([_line(10, 10)])
    no_data = material_stats([_line(10, None)])

    assert on_plan["overrun_percent"] == 0.0
    assert no_data["overrun_percent"] is None
    assert on_plan["lines_with_fact"] == 1
    assert no_data["lines_with_fact"] == 0


def test_an_empty_estimate_does_not_divide_by_zero():
    stats = material_stats([])
    assert stats["planned"] == 0
    assert stats["actual"] == 0
    assert stats["overrun_percent"] is None
    assert stats["lines_total"] == 0


def test_non_material_lines_are_not_counted():
    """Страховка: считаем материалы, а не всю смету."""
    work = SimpleNamespace(
        line_type=LineType.work, quantity_planned=100, quantity_actual=100, unit_price=50
    )
    stats = material_stats([_line(10, 10), work])
    assert stats["planned"] == 1000
    assert stats["actual"] == 1000
