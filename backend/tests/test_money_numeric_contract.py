"""Currency amounts must be exact decimal, not binary floating point.

`double precision` cannot represent most decimal money values, which produced
three concrete defects on a live database:

* a written amount drifts (1234.56 persisting as 1234.5600000000001);
* ``SUM()`` is order-dependent, so a budget total can disagree with itself;
* equality between a payment and a bank-statement/fiscal claim fails for
  amounts that are equal to the kopeck — see
  ``bank_statement_integrity._payment_matches`` and ``fns/receipt_verify``.

The PostgreSQL-backed test at the bottom proves the property on a real engine.
The SQLite path cannot prove it (NUMERIC has REAL affinity there), so it is
skipped rather than asserted falsely.
"""
from __future__ import annotations

import importlib.util
import os
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.db.base import Base
from app.models.money import MONEY, MONEY_PRECISION, MONEY_SCALE, money_column

import app.models  # noqa: F401 — register the canonical model package


def _load_migration(filename: str):
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration("w24moneynumeric01_money_numeric_columns.py")

# Currency amounts only. Measurements (m², %, quantities, coefficients,
# ratings, pin coordinates) stay double precision on purpose.
MONEY_COLUMNS: tuple[tuple[str, str], ...] = tuple(_MIGRATION.MONEY_COLUMNS)

MEASUREMENT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("projects", "total_area_sqm"),
    ("projects", "progress_percent"),
    ("projects", "vat_rate"),
    ("rooms", "length_m"),
    ("rooms", "height_m"),
    ("estimate_lines", "quantity_planned"),
    ("estimate_lines", "quantity_actual"),
    ("stages", "percent_complete"),
    ("material_picks", "qty"),
    ("waste_orders", "volume_m3"),
)


def _column(table_name: str, column_name: str) -> sa.Column:
    table = Base.metadata.tables[table_name]
    assert column_name in table.c, f"{table_name}.{column_name} is not mapped"
    return table.c[column_name]


@pytest.mark.parametrize(("table_name", "column_name"), MONEY_COLUMNS)
def test_every_currency_column_is_exact_decimal(table_name: str, column_name: str):
    column_type = _column(table_name, column_name).type

    assert isinstance(column_type, sa.Numeric), (
        f"{table_name}.{column_name} is {column_type!r}; currency must be numeric"
    )
    assert not isinstance(column_type, sa.Float)
    assert column_type.precision == MONEY_PRECISION
    assert column_type.scale == MONEY_SCALE


@pytest.mark.parametrize(("table_name", "column_name"), MEASUREMENT_COLUMNS)
def test_measurements_are_deliberately_left_as_float(table_name: str, column_name: str):
    column_type = _column(table_name, column_name).type

    assert isinstance(column_type, sa.Float), (
        f"{table_name}.{column_name} is a measurement, not currency; "
        "converting it would change quantity semantics without cause"
    )


def test_money_reads_back_as_float_so_service_arithmetic_is_unchanged():
    """asdecimal=False is load-bearing, not incidental.

    Returning Decimal here would raise TypeError in every service that mixes a
    stored amount with a float literal, and would change every JSON response.
    """
    assert MONEY.asdecimal is False
    assert money_column().asdecimal is False


def test_migration_covers_exactly_the_mapped_currency_columns():
    mapped = {
        (table_name, column_name)
        for table_name, column_name in MONEY_COLUMNS
        if table_name in Base.metadata.tables
    }
    for table_name, column_name in mapped:
        assert isinstance(_column(table_name, column_name).type, sa.Numeric)


def test_migration_rounds_once_and_chains_onto_the_index_head():
    source = Path(_MIGRATION.__file__).read_text(encoding="utf-8")

    assert _MIGRATION.revision == "w24moneynumeric01"
    assert _MIGRATION.down_revision == "w23scopeindexes01"
    assert "round(" in source, "existing doubles must be rounded deterministically"
    assert "numeric(14, 2)" in source


# --- real-engine proof -------------------------------------------------------

_POSTGRES_URL = (os.environ.get("MONEY_NUMERIC_POSTGRES_URL") or "").strip()


@pytest.mark.skipif(
    not _POSTGRES_URL,
    reason="MONEY_NUMERIC_POSTGRES_URL is required; SQLite NUMERIC has REAL affinity "
    "and cannot prove decimal exactness",
)
async def test_postgresql_money_column_is_exact_in_storage_sum_and_comparison():
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(_POSTGRES_URL)
    try:
        async with engine.begin() as conn:
            await conn.exec_driver_sql("DROP TABLE IF EXISTS money_contract_probe")
            await conn.exec_driver_sql(
                "CREATE TABLE money_contract_probe ("
                "  id serial PRIMARY KEY,"
                "  as_float double precision NOT NULL,"
                "  as_money numeric(14, 2) NOT NULL)"
            )
            for _ in range(10):
                await conn.exec_driver_sql(
                    "INSERT INTO money_contract_probe (as_float, as_money) VALUES (0.1, 0.1)"
                )

            float_sum = (
                await conn.exec_driver_sql("SELECT sum(as_float) FROM money_contract_probe")
            ).scalar_one()
            money_sum = (
                await conn.exec_driver_sql("SELECT sum(as_money) FROM money_contract_probe")
            ).scalar_one()

            # The defect being fixed: the float total is not one rouble and an
            # equality check against a provider claim of 1.00 fails.
            assert float_sum != 1.0
            assert money_sum == Decimal("1.00")

            float_matches = (
                await conn.exec_driver_sql(
                    "SELECT sum(as_float) = 1.0 FROM money_contract_probe"
                )
            ).scalar_one()
            money_matches = (
                await conn.exec_driver_sql(
                    "SELECT sum(as_money) = 1.00 FROM money_contract_probe"
                )
            ).scalar_one()
            assert float_matches is False
            assert money_matches is True

            # A written amount is stored exactly, not as the nearest double.
            await conn.exec_driver_sql(
                "INSERT INTO money_contract_probe (as_float, as_money) "
                "VALUES (1234.565, 1234.565)"
            )
            stored = (
                await conn.exec_driver_sql(
                    "SELECT as_money FROM money_contract_probe ORDER BY id DESC LIMIT 1"
                )
            ).scalar_one()
            assert stored == Decimal("1234.57")
            assert stored.as_tuple().exponent == -MONEY_SCALE

            await conn.exec_driver_sql("DROP TABLE money_contract_probe")
    finally:
        await engine.dispose()
