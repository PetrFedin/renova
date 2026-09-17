"""store currency amounts as numeric(14,2) instead of double precision

Every monetary column was ``double precision``. Binary floating point cannot
represent most decimal money values exactly, which has three consequences on a
live database:

* a written amount drifts (``1234.56`` persisting as ``1234.5600000000001``);
* ``SUM()`` over a column is order-dependent, so a budget total can disagree
  with itself between two reads;
* an equality comparison between a payment and a bank-statement or fiscal
  receipt claim can fail for amounts that are equal to the kopeck. See
  ``bank_statement_integrity._matches`` and ``fns/receipt_verify``.

``numeric(14, 2)`` is exact in storage, in aggregation and in comparison, and
PostgreSQL rounds every write back to two decimal places so error cannot
accumulate across successive updates.

The ORM keeps reading these columns as ``float`` (``asdecimal=False``), so no
service arithmetic, response schema or mobile type changes in this migration.

Existing rows are converted with ``round(col::numeric, 2)``: the stored double
is rounded once, deterministically, to the value it was always meant to be.

Non-PostgreSQL dialects are skipped. Staging/production forbid SQLite by
policy, and the bounded local/test SQLite path builds its schema from ORM
metadata (``Base.metadata.create_all``), which already carries the new type.

Revision ID: w24moneynumeric01
Revises: w23scopeindexes01
Create Date: 2026-09-17
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "w24moneynumeric01"
down_revision: str | None = "w23scopeindexes01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (table, column) for every currency amount. Measurements (m², %, quantities,
# coefficients, ratings, pin coordinates) intentionally stay double precision.
MONEY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("projects", "budget_planned"),
    ("projects", "budget_spent"),
    ("projects", "customer_budget"),
    ("estimate_lines", "unit_price"),
    ("stages", "payment_amount"),
    ("payments", "amount"),
    ("change_orders", "amount"),
    ("receipts", "amount"),
    ("expenses", "amount"),
    ("budget_lines", "planned_amount"),
    ("budget_lines", "actual_amount"),
    ("margin_snapshots", "margin_estimated"),
    ("purchases", "total_amount"),
    ("purchase_items", "unit_price"),
    ("material_picks", "price"),
    ("selection_items", "allowance"),
    ("selection_items", "price"),
    ("waste_orders", "price"),
    ("job_leads", "budget_hint"),
    ("job_leads", "pre_estimate"),
    ("job_lead_quotes", "pre_estimate"),
    ("work_orders", "budget_planned"),
    ("work_orders", "budget_spent"),
    ("subscription_checkouts", "amount"),
    ("subscription_checkouts", "refunded_amount"),
    ("subscription_refunds", "amount"),
)

_MONEY_TYPE = "numeric(14, 2)"
_FLOAT_TYPE = "double precision"


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_postgresql():
        return
    for table, column in MONEY_COLUMNS:
        op.execute(
            f'ALTER TABLE "{table}" ALTER COLUMN "{column}" '
            f'TYPE {_MONEY_TYPE} USING round("{column}"::numeric, 2)'
        )


def downgrade() -> None:
    if not _is_postgresql():
        return
    # Reversible in type, not in precision: a value already rounded to two
    # decimals on upgrade stays rounded. That is the intended truth, not data
    # loss — the pre-upgrade extra digits were floating-point noise.
    for table, column in reversed(MONEY_COLUMNS):
        op.execute(
            f'ALTER TABLE "{table}" ALTER COLUMN "{column}" '
            f'TYPE {_FLOAT_TYPE} USING "{column}"::double precision'
        )
