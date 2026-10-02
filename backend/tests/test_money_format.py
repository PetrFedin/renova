from decimal import Decimal

import pytest

from app.core.money_format import format_amount, format_rub


@pytest.mark.parametrize(
    "value,expected",
    [
        (1500.0, "1 500 ₽"),
        (1500, "1 500 ₽"),
        (Decimal("1500.00"), "1 500 ₽"),
        ("1500.0", "1 500 ₽"),
        (1500.5, "1 500,50 ₽"),
        (Decimal("1234567.891"), "1 234 567,89 ₽"),
        (999, "999 ₽"),
        (0, "0 ₽"),
        (None, "0 ₽"),
        ("abc", "0 ₽"),
        (float("nan"), "0 ₽"),
        (-2500.0, "-2 500 ₽"),
        (1e6, "1 000 000 ₽"),
    ],
)
def test_format_rub(value, expected):
    assert format_rub(value) == expected
    assert ".0 " not in format_rub(value)


def test_format_amount_without_currency():
    assert format_amount(12000.0) == "12 000"
