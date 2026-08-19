"""Fail when mapped ORM columns diverge from the migrated PostgreSQL schema.

This complements ``verify_migration_schema.py``. The migration verifier is deliberately
ORM-independent; this verifier checks the opposite boundary so a model-only column
cannot stay hidden behind SQLite ``Base.metadata.create_all`` tests.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base

# Import every mapped-model module used by the application before reading metadata.
import app.models.client_write_request  # noqa: F401,E402
import app.models.entities  # noqa: F401,E402
import app.models.outbox_runtime  # noqa: F401,E402
import app.models.project_documents  # noqa: F401,E402
import app.models.webhook_runtime  # noqa: F401,E402
import app.models.work_schedule  # noqa: F401,E402


class OrmSchemaMismatch(RuntimeError):
    pass


def _database_url() -> str:
    value = (os.environ.get("DATABASE_URL") or "").strip()
    if not value:
        raise OrmSchemaMismatch("DATABASE_URL is required")
    if not value.startswith("postgresql+asyncpg://"):
        raise OrmSchemaMismatch("ORM schema parity requires PostgreSQL/asyncpg DATABASE_URL")
    return value


def _verify(sync_connection) -> None:
    inspector = inspect(sync_connection)
    available_tables = set(inspector.get_table_names())
    failures: list[str] = []

    for table_name, table in sorted(Base.metadata.tables.items()):
        if table_name not in available_tables:
            failures.append(f"missing migrated table: {table_name}")
            continue

        orm_columns = set(table.columns.keys())
        migrated_columns = {column["name"] for column in inspector.get_columns(table_name)}
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

    if failures:
        raise OrmSchemaMismatch("ORM/Alembic column parity failed:\n" + "\n".join(failures))


async def _run() -> None:
    engine = create_async_engine(_database_url())
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_verify)
    finally:
        await engine.dispose()
    print("ORM/Alembic PostgreSQL column parity: OK")


if __name__ == "__main__":
    asyncio.run(_run())
