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


from app.core.money_format import normalize_activity_body


@pytest.mark.parametrize(
    "kind,body,expected",
    [
        ("ExpenseRemoved", "1500.0", "1 500 ₽"),
        ("ExpenseAdded", "1500.50", "1 500,50 ₽"),
        ("ExpenseAdded", "1500", "1 500 ₽"),
        ("PaymentApproved", "25000.00", "25 000 ₽"),
        ("ExpenseAdded", "1 500 ₽ · Материалы", "1 500 ₽ · Материалы"),
        ("ExpenseAdded", "1500.0 · Материалы", "1 500 ₽ · Материалы"),
        ("MaterialCalculated", "12", "12"),
        ("MaterialCalculated", "1500.0", "1500.0"),
        ("MaterialPriceSet", "12.50 → 15.00 ₽ · вручную", "12,50 → 15 ₽ · вручную"),
        ("ExpenseAdded", None, None),
        ("ExpenseAdded", "", ""),
    ],
)
def test_normalize_activity_body(kind, body, expected):
    assert normalize_activity_body(kind, body) == expected
    assert normalize_activity_body(kind, normalize_activity_body(kind, body)) == expected


@pytest.mark.asyncio
async def test_project_feed_normalizes_legacy_body():
    """Старая запись с body='1500.0' отдаётся в ленте как «1 500 ₽» без миграции данных."""
    from datetime import datetime
    from types import SimpleNamespace

    from app.services import activity_service

    event = SimpleNamespace(
        id="e1", kind="ExpenseRemoved", title="Чек удалён", body="1500.0",
        work_type=None, room_id=None, link_path=None, created_at=datetime(2026, 1, 1),
    )

    class _Res:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    class _Db:
        calls = 0

        async def execute(self, _query):
            _Db.calls += 1
            return _Res([event] if _Db.calls == 1 else [])

    items = await activity_service.project_feed(_Db(), "p1")
    assert items[0]["body"] == "1 500 ₽"
    assert event.body == "1500.0"


def test_notification_body_bare_number_is_formatted():
    from app.core.money_format import normalize_activity_body, normalize_notification_body

    assert normalize_notification_body("15000.0") == "15 000 ₽"
    assert normalize_notification_body("Документ 1 · 1 500 ₽") == "Документ 1 · 1 500 ₽"
    assert normalize_notification_body(None) is None
    assert normalize_activity_body("ChangeOrderApproved", "15000.0") == "15 000 ₽"


def test_chat_task_due_date_is_russian():
    from app.services.chat_service import _ru_date

    assert _ru_date("2026-10-05") == "05.10.2026"
    assert _ru_date("2026-10-05T10:00:00Z") == "05.10.2026"
    assert _ru_date("скоро") == "скоро"
