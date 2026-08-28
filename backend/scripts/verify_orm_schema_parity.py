"""Fail when mapped ORM columns diverge from the migrated PostgreSQL schema.

This complements ``verify_migration_schema.py``. The migration verifier is deliberately
ORM-independent; this verifier checks the opposite boundary so model-only columns or
native enum labels cannot stay hidden behind SQLite ``Base.metadata.create_all`` tests.
"""
from __future__ import annotations

import asyncio
import os

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base

# Import the canonical package registry before reading metadata.
import app.models  # noqa: F401,E402


class OrmSchemaMismatch(RuntimeError):
    pass


def _database_url() -> str:
    value = (os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise OrmSchemaMismatch("DATABASE_URL is required")
    if not value.startswith("postgresql+asyncpg://"):
        raise OrmSchemaMismatch("ORM schema parity requires PostgreSQL/asyncpg DATABASE_URL")
    return value


def _verify_native_enum(
    *,
    table_name: str,
    column_name: str,
    orm_type: sa.Enum,
    migrated_type: object,
    failures: list[str],
) -> None:
    if not orm_type.native_enum:
        return
    if not isinstance(migrated_type, PG_ENUM):
        failures.append(
            f"{table_name}.{column_name}: ORM requires native PostgreSQL enum "
            f"{orm_type.name!r}, migrated type is {migrated_type!r}"
        )
        return

    expected_name = orm_type.name
    actual_name = migrated_type.name
    if expected_name != actual_name:
        failures.append(
            f"{table_name}.{column_name}: enum name mismatch "
            f"ORM={expected_name!r} PostgreSQL={actual_name!r}"
        )

    expected_values = tuple(orm_type.enums)
    actual_values = tuple(migrated_type.enums)
    if expected_values != actual_values:
        failures.append(
            f"{table_name}.{column_name}: enum values mismatch "
            f"ORM={expected_values!r} PostgreSQL={actual_values!r}"
        )


def _verify(sync_connection) -> None:
    inspector = inspect(sync_connection)
    available_tables = set(inspector.get_table_names())
    failures: list[str] = []

    for table_name, table in sorted(Base.metadata.tables.items()):
        if table_name not in available_tables:
            failures.append(f"missing migrated table: {table_name}")
            continue

        migrated_columns_by_name = {
            column["name"]: column for column in inspector.get_columns(table_name)
        }
        orm_columns = set(table.columns.keys())
        migrated_columns = set(migrated_columns_by_name)
        missing_in_db = sorted(orm_columns - migrated_columns)
        missing_in_orm = sorted(migrated_columns - orm_columns)
        if missing_in_db:
            failures.append(
                f"{table_name}: ORM-only columns absent from Alembic schema: {missing_in_db}"
            )
        if missing_in_orm:
            failures.append(
                f"{table_name}: migrated columns absent from ORM metadata: {missing_in_orm}"
            )

        for column in table.columns:
            migrated = migrated_columns_by_name.get(column.name)
            if migrated is None:
                continue
            if isinstance(column.type, sa.Enum):
                _verify_native_enum(
                    table_name=table_name,
                    column_name=column.name,
                    orm_type=column.type,
                    migrated_type=migrated["type"],
                    failures=failures,
                )

    if failures:
        raise OrmSchemaMismatch(
            "ORM/Alembic PostgreSQL parity failed:\n" + "\n".join(failures)
        )


async def _run() -> None:
    engine = create_async_engine(_database_url())
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_verify)
    finally:
        await engine.dispose()
    print("ORM/Alembic PostgreSQL column + native-enum parity: OK")


if __name__ == "__main__":
    asyncio.run(_run())
