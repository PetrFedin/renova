"""Verify the current Alembic schema contract without duplicating legacy checks.

`verify_migration_schema.py` owns the reflected structural checks accumulated
through w15. This wrapper binds those checks to the actual bundled Alembic
head and adds migration-owned native-enum assertions introduced by w16/w17.
Future migrations must extend this verifier when they introduce new reflected
schema invariants.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.migration_guard import bundled_alembic_heads
import verify_migration_schema as legacy_schema


_EXPECTED_ENUMS: dict[tuple[str, str], tuple[str, tuple[str, ...]]] = {
    ("purchases", "status"): (
        "purchasestatus",
        ("draft", "approved", "ordered", "paid", "partial", "delivered", "cancelled", "returned"),
    ),
    ("material_picks", "status"): (
        "materialpickstatus",
        ("draft", "pending", "approved", "purchased"),
    ),
    ("selection_items", "status"): (
        "selectionstatus",
        ("draft", "proposed", "approved", "rejected"),
    ),
    ("chat_messages", "message_type"): (
        "chatmessagetype",
        ("text", "photo", "file", "confirm", "system", "task", "invoice", "payment"),
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
    for (table, column), (expected_name, expected_values) in _EXPECTED_ENUMS.items():
        columns = {item["name"]: item for item in inspector.get_columns(table)}
        legacy_schema._require(column in columns, f"{table}.{column} is missing")
        enum_type = columns[column]["type"]
        legacy_schema._require(
            isinstance(enum_type, ENUM),
            f"{table}.{column} must be a native PostgreSQL enum, got {enum_type!r}",
        )
        legacy_schema._require(
            enum_type.name == expected_name,
            f"{table}.{column} enum name must be {expected_name}, got {enum_type.name!r}",
        )
        legacy_schema._require(
            tuple(enum_type.enums) == expected_values,
            f"{table}.{column} enum values mismatch: "
            f"expected={expected_values!r} actual={tuple(enum_type.enums)!r}",
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
