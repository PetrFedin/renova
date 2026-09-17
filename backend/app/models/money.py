"""Canonical SQL type for currency amounts.

Every monetary column used to be ``Float`` (PostgreSQL ``double precision``).
Binary floating point cannot represent most decimal money values exactly, so a
stored amount could drift (``1234.56`` persisting as ``1234.5600000000001``),
``SUM()`` over a column depended on row order, and an equality comparison
between a payment and a bank/fiscal claim could fail for values that are equal
in rubles and kopecks.

``MONEY`` stores ``numeric(14, 2)``: exact decimal storage, exact SQL
aggregation and exact SQL comparison. PostgreSQL rounds a written value to two
decimal places, so error cannot accumulate across successive writes.

``asdecimal=False`` is deliberate and load-bearing. The application layer and
every JSON response keep working with ``float`` exactly as before, so this
change has no effect on service arithmetic, schema types or the mobile client.
It fixes the storage and SQL half of the problem without a repo-wide
``Decimal`` migration; moving the finance services themselves to ``Decimal``
arithmetic is tracked separately and is not claimed here.

Range: 12 integer digits, i.e. up to 999_999_999_999.99 — far above any
plausible renovation budget, while still rejecting a runaway value.
"""
from __future__ import annotations

from sqlalchemy import Numeric

MONEY_PRECISION = 14
MONEY_SCALE = 2


def money_column() -> Numeric:
    """Return a fresh ``numeric(14, 2)`` type that reads back as ``float``."""
    return Numeric(MONEY_PRECISION, MONEY_SCALE, asdecimal=False)


# Convenience alias for declarative models. SQLAlchemy type objects are
# immutable descriptors and are safe to share between columns.
MONEY = money_column()
