"""Единое русское форматирование сумм для текстов активности и уведомлений.

1500.0 -> «1 500 ₽», 1500.5 -> «1 500,50 ₽», 1234567 -> «1 234 567 ₽».
Принимает int/float/Decimal/str/None; нечисловое значение трактуется как 0.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

RUB = "₽"


def _to_decimal(value: object) -> Decimal:
    if value is None:
        return Decimal(0)
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal(0)
    return dec if dec.is_finite() else Decimal(0)


def format_amount(value: object) -> str:
    """Число без валюты: целые без «.0», разряды пробелом, дробная часть через запятую."""
    dec = _to_decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if dec < 0 else ""
    whole, _, frac = f"{abs(dec):.2f}".partition(".")
    grouped = f"{int(whole):,}".replace(",", " ")
    return f"{sign}{grouped}" + ("" if frac == "00" else f",{frac}")


def format_rub(value: object) -> str:
    return f"{format_amount(value)} {RUB}"


_MONEY_KIND_PREFIXES = ("Expense", "Payment", "BankImport", "Receipt")
_BARE_NUMBER = re.compile(r"^-?\d+(?:\.\d+)?$")
_PRICE_CHANGE = re.compile(r"(-?\d+\.\d+) → (-?\d+\.\d+) ₽")


def normalize_activity_body(kind: str | None, body: str | None) -> str | None:
    """Нормализует «сырые» суммы в тексте старых записей ленты при чтении.

    Старые события писались как ``str(amount)`` («1500.0»). Данные не
    мигрируем — приводим к «1 500 ₽» на лету. Консервативно: голые числа
    трогаем только у денежных видов событий (``MaterialCalculated`` хранит
    количество, а не рубли); уже отформатированный текст не меняется.
    """
    if not body:
        return body
    text = _PRICE_CHANGE.sub(lambda m: f"{format_amount(m.group(1))} → {format_rub(m.group(2))}", body)
    if kind and kind.startswith(_MONEY_KIND_PREFIXES):
        parts = text.split(" · ")
        text = " · ".join(format_rub(p.strip()) if _BARE_NUMBER.match(p.strip()) else p for p in parts)
    return text
