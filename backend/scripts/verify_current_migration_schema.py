"""Verify the current Alembic schema contract without duplicating legacy checks.

`verify_migration_schema.py` owns the reflected structural checks accumulated
through w15. This wrapper binds those checks to the actual bundled Alembic
head and adds the w16 native-enum parity assertions. Future migrations must
extend this verifier when they introduce new reflected schema invariants.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.migration_guard import bundled_alembic_heads
import verify_migration_schema as legacy_schema


_EXPECTED_ENUMS: dict[str, tuple[str, tuple[str, ...]]] = {
    "purchases": (
        "purchasestatus",
        ("draft", "approved", "ordered", "paid", "partial", "delivered", "cancelled", "returned"),
    ),
    "material_picks": (
        "materialpickstatus",
        ("draft", "pending", "approved", "purchased"),
    ),
    "selection_items": (
        "selectionstatus",
        ("draft", "proposed", "approved", "rejected"),
    ),
}


def _verify_current(sync_connection) -> None:
    heads = bundled_alembic_heads()
    legacy_schema._require(
        len(heads) == 1,
        f"Current schema verifier requires exactly one bundled Alembic head, found {heads!r}",
    )
    current_head = heads[0]

    # Reuse every reflected invariant accumulated by the existing verifier,
    # but bind its present-state revision guard to the actual packaged head.
    legacy_schema._PRESENT_REVISION = current_head
    legacy_schema._verify_present(sync_connection)

    inspector = inspect(sync_connection)
    for table, (expected_name, expected_values) in _EXPECTED_ENUMS.items():
        columns = {column["name"]: column for column in inspector.get_columns(table)}
        legacy_schema._require("status" in columns, f"{table}.status is missing")
        status_type = columns["status"]["type"]
        legacy_schema._require(
            isinstance(status_type, ENUM),
            f"{table}.status must be a native PostgreSQL enum, got {status_type!r}",
        )
        legacy_schema._require(
            status_type.name == expected_name,
            f"{table}.status enum name must be {expected_name}, got {status_type.name!r}",
        )
        legacy_schema._require(
            tuple(status_type.enums) == expected_values,
            f"{table}.status enum values mismatch: expected={expected_values!r} actual={tuple(status_type.enums)!r}",
        )


async def _main() -> None:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    legacy_schema._require(bool(database_url), "DATABASE_URL is required")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_verify_current)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
