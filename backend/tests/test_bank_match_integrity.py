from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models.entities import PaymentStatus
from app.services.integrations.bank_import import match_bank_rows_to_payments

pytestmark = pytest.mark.asyncio


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _Db:
    def __init__(self, payments):
        self._payments = payments

    async def execute(self, _statement):
        return _ScalarRows(self._payments)


def _payment(payment_id: str, amount: float, created_at: datetime):
    return SimpleNamespace(
        id=payment_id,
        project_id="project-1",
        title="Оплата этапа",
        amount=amount,
        status=PaymentStatus.pending,
        confirmed_at=None,
        created_at=created_at,
    )


async def test_unique_stale_exact_amount_is_retained_with_weak_confidence():
    db = _Db([_payment("p1", 125000, datetime(2026, 1, 1, tzinfo=timezone.utc))])
    result = await match_bank_rows_to_payments(
        db,
        SimpleNamespace(id="project-1"),
        [{"date": "2026-07-19", "amount": 125000, "description": "Оплата этапа"}],
    )

    assert result["matched"] == 1
    match = result["matches"][0]
    assert match["payment_id"] == "p1"
    assert match["date_match"] is False
    assert match["match_basis"] == "unique_amount"


async def test_ambiguous_stale_exact_amount_is_not_auto_matched():
    db = _Db(
        [
            _payment("p1", 125000, datetime(2026, 1, 1, tzinfo=timezone.utc)),
            _payment("p2", 125000, datetime(2026, 1, 2, tzinfo=timezone.utc)),
        ]
    )
    result = await match_bank_rows_to_payments(
        db,
        SimpleNamespace(id="project-1"),
        [{"date": "2026-07-19", "amount": 125000, "description": "Оплата этапа"}],
    )

    assert result["matched"] == 0
    assert result["unmatched_rows"] == 1
    assert result["unmatched_pending_payments"] == 2
