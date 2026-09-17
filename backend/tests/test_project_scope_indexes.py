"""Scope columns on core domain tables must stay indexed.

PostgreSQL does not index a foreign key automatically. Every
``GET /projects/{project_id}/...`` read, every chat thread read and the project
purge/trash traversal filter on one of these columns, so an unindexed scope
column means a sequential scan of the whole table on the hottest paths.

The contract is asserted on ORM metadata (dialect-independent, so it also holds
for the bounded SQLite path that builds its schema from ``create_all``) and on
the migration that materialises the same names on PostgreSQL.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.db.base import Base

import app.models  # noqa: F401 — register the canonical model package
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401


def _load_migration(filename: str):
    """`alembic/versions` is a script directory, not an importable package."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration("w23scopeindexes01_project_scope_indexes.py")

# (table, column) that must be reachable through an index in leading position.
REQUIRED_SCOPE_INDEXES: tuple[tuple[str, str], ...] = (
    ("rooms", "project_id"),
    ("stages", "project_id"),
    ("payments", "project_id"),
    ("receipts", "project_id"),
    ("change_orders", "project_id"),
    ("estimate_lines", "project_id"),
    ("chat_threads", "project_id"),
    ("room_change_requests", "project_id"),
    ("app_notifications", "project_id"),
    ("chat_messages", "thread_id"),
    ("stage_comments", "stage_id"),
    ("stage_photos", "stage_id"),
    ("payments", "stage_id"),
    ("receipts", "stage_id"),
    ("expenses", "stage_id"),
    ("budget_lines", "stage_id"),
    ("project_issues", "stage_id"),
    ("estimate_lines", "room_id"),
    ("receipts", "room_id"),
    ("expenses", "room_id"),
    ("budget_lines", "room_id"),
    ("project_issues", "room_id"),
    ("room_change_requests", "room_id"),
    ("work_acceptances", "room_id"),
    ("projects", "customer_id"),
    ("projects", "contractor_id"),
)


def _leading_indexed_columns(table_name: str) -> set[str]:
    table = Base.metadata.tables[table_name]
    leading: set[str] = set()
    for index in table.indexes:
        columns = list(index.columns)
        if columns:
            leading.add(columns[0].name)
    # A primary key and a unique constraint are backed by an index too.
    if table.primary_key is not None:
        pk_columns = list(table.primary_key.columns)
        if pk_columns:
            leading.add(pk_columns[0].name)
    return leading


@pytest.mark.parametrize(("table_name", "column"), REQUIRED_SCOPE_INDEXES)
def test_orm_metadata_indexes_every_scope_column(table_name: str, column: str):
    assert table_name in Base.metadata.tables, f"unknown table {table_name}"
    assert column in _leading_indexed_columns(table_name), (
        f"{table_name}.{column} has no index in leading position; "
        "every project/thread/stage/room scoped read would sequential-scan"
    )


def test_migration_covers_exactly_the_required_scope_columns():
    migrated = {(table, column) for _name, table, column in _MIGRATION.SCOPE_INDEXES}

    assert migrated == set(REQUIRED_SCOPE_INDEXES)


def test_migration_index_names_match_the_sqlalchemy_convention():
    for name, table, column in _MIGRATION.SCOPE_INDEXES:
        assert name == f"ix_{table}_{column}", (
            "migration and ORM metadata must agree on the index name, "
            "otherwise PostgreSQL and the SQLite create_all path diverge"
        )


def test_migration_is_idempotent_and_non_blocking_on_postgresql():
    source = Path(_MIGRATION.__file__).read_text(encoding="utf-8")

    assert "autocommit_block()" in source, "CONCURRENTLY cannot run in a transaction"
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in source
    assert "DROP INDEX CONCURRENTLY IF EXISTS" in source


def test_migration_chains_onto_the_previous_head():
    assert _MIGRATION.revision == "w23scopeindexes01"
    assert _MIGRATION.down_revision == "w22projectparticipants01"
