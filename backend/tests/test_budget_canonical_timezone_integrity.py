from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import budget_service


def expense(*, expense_id: str, status: str, created_at: datetime | None):
    return SimpleNamespace(id=expense_id, status=status, created_at=created_at)


def test_canonical_created_at_accepts_naive_aware_offset_and_missing_values():
    naive = datetime(2026, 7, 30, 9, 0, 0)
    utc_aware = datetime(2026, 7, 30, 9, 0, 0, tzinfo=timezone.utc)
    offset_aware = datetime(2026, 7, 30, 12, 0, 0, tzinfo=timezone(timedelta(hours=3)))

    naive_value = budget_service._canonical_created_at(naive)
    utc_value = budget_service._canonical_created_at(utc_aware)
    offset_value = budget_service._canonical_created_at(offset_aware)
    missing_value = budget_service._canonical_created_at(None)

    assert naive_value == utc_value == offset_value
    assert missing_value == float("-inf")


def test_canonical_key_does_not_raise_for_mixed_timestamp_awareness():
    rows = [
        expense(
            expense_id="aware",
            status="confirmed",
            created_at=datetime(2026, 7, 30, 9, 0, tzinfo=timezone.utc),
        ),
        expense(
            expense_id="naive",
            status="confirmed",
            created_at=datetime(2026, 7, 30, 8, 0),
        ),
        expense(expense_id="missing", status="confirmed", created_at=None),
    ]

    keep = min(rows, key=budget_service._expense_canonical_key)

    assert keep.id == "missing"


def test_protected_status_priority_remains_stronger_than_timestamp_order():
    rows = [
        expense(
            expense_id="old-active",
            status="confirmed",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        ),
        expense(
            expense_id="new-refund",
            status="refund",
            created_at=datetime(2026, 7, 30, tzinfo=timezone.utc),
        ),
    ]

    keep = min(rows, key=budget_service._expense_canonical_key)

    assert keep.id == "new-refund"


def test_equal_instants_use_id_as_deterministic_final_tiebreaker():
    rows = [
        expense(
            expense_id="expense-b",
            status="confirmed",
            created_at=datetime(2026, 7, 30, 12, 0, tzinfo=timezone(timedelta(hours=3))),
        ),
        expense(
            expense_id="expense-a",
            status="confirmed",
            created_at=datetime(2026, 7, 30, 9, 0, tzinfo=timezone.utc),
        ),
    ]

    keep = min(rows, key=budget_service._expense_canonical_key)

    assert keep.id == "expense-a"
