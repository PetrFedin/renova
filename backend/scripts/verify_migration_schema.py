"""Reflect the database and enforce the calendar Alembic contract.

The verifier never imports ORM metadata.  It is intentionally run after real
Alembic transitions so model-only schema changes cannot create a false
production-readiness signal.
"""
from __future__ import annotations

import argparse
import asyncio
import os

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


_PRESENT_REVISION = "w8calendarintegrity01"
_ABSENT_REVISION = "w6webhookdelivery01"


class SchemaMismatch(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SchemaMismatch(message)


def _current_revision(sync_connection) -> str:
    value = sync_connection.execute(
        text("SELECT version_num FROM alembic_version")
    ).scalar_one()
    return str(value)


def _verify_present(sync_connection) -> None:
    _require(
        _current_revision(sync_connection) == _PRESENT_REVISION,
        f"Alembic head must be {_PRESENT_REVISION}",
    )

    inspector = inspect(sync_connection)
    tables = set(inspector.get_table_names())
    _require("users" in tables, "users table is missing after Alembic upgrade")
    _require(
        "calendar_items" in tables,
        "calendar_items table is missing after Alembic upgrade",
    )

    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    _require(
        "ics_token" in user_columns,
        "users.ics_token is missing after Alembic upgrade",
    )
    ics_token = user_columns["ics_token"]
    _require(ics_token.get("nullable") is True, "users.ics_token must be nullable")

    user_indexes = {
        index["name"]: index
        for index in inspector.get_indexes("users")
        if index.get("name")
    }
    ics_index = user_indexes.get("ix_users_ics_token")
    _require(ics_index is not None, "ix_users_ics_token is missing")
    _require(bool(ics_index.get("unique")), "ix_users_ics_token must be unique")
    _require(
        list(ics_index.get("column_names") or []) == ["ics_token"],
        "ix_users_ics_token must target only users.ics_token",
    )

    expected_columns = {
        "id",
        "user_id",
        "project_id",
        "stage_id",
        "title",
        "description",
        "start_at",
        "end_at",
        "all_day",
        "event_type",
        "color",
        "is_public",
        "recurrence",
        "location",
        "reminder_at",
        "reminder_sent",
        "created_at",
        "updated_at",
    }
    calendar_columns = {
        column["name"]: column
        for column in inspector.get_columns("calendar_items")
    }
    missing_columns = expected_columns - set(calendar_columns)
    _require(
        not missing_columns,
        f"calendar_items columns are missing: {sorted(missing_columns)}",
    )

    nullable_columns = {
        "project_id",
        "stage_id",
        "description",
        "color",
        "recurrence",
        "location",
        "reminder_at",
    }
    for name in expected_columns:
        expected_nullable = name in nullable_columns
        _require(
            bool(calendar_columns[name].get("nullable")) is expected_nullable,
            f"calendar_items.{name} nullable mismatch",
        )

    primary_key = inspector.get_pk_constraint("calendar_items")
    _require(
        list(primary_key.get("constrained_columns") or []) == ["id"],
        "calendar_items primary key must be id",
    )

    foreign_keys = {
        tuple(foreign_key.get("constrained_columns") or []): (
            foreign_key.get("referred_table"),
            tuple(foreign_key.get("referred_columns") or []),
        )
        for foreign_key in inspector.get_foreign_keys("calendar_items")
    }
    expected_foreign_keys = {
        ("user_id",): ("users", ("id",)),
        ("project_id",): ("projects", ("id",)),
        ("stage_id",): ("stages", ("id",)),
    }
    for columns, target in expected_foreign_keys.items():
        _require(
            foreign_keys.get(columns) == target,
            f"calendar_items foreign key mismatch for {columns}: "
            f"{foreign_keys.get(columns)}",
        )

    expected_indexes = {
        "ix_calendar_items_user_id": ["user_id"],
        "ix_calendar_items_project_id": ["project_id"],
        "ix_calendar_items_stage_id": ["stage_id"],
        "ix_calendar_items_start_at": ["start_at"],
        "ix_calendar_items_end_at": ["end_at"],
        "ix_calendar_items_event_type": ["event_type"],
        "ix_calendar_items_is_public": ["is_public"],
        "ix_calendar_items_reminder_at": ["reminder_at"],
    }
    calendar_indexes = {
        index["name"]: index
        for index in inspector.get_indexes("calendar_items")
        if index.get("name")
    }
    for name, columns in expected_indexes.items():
        index = calendar_indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(
            list(index.get("column_names") or []) == columns,
            f"{name} targets {index.get('column_names')}, expected {columns}",
        )
        _require(not bool(index.get("unique")), f"{name} must not be unique")


def _verify_absent(sync_connection) -> None:
    _require(
        _current_revision(sync_connection) == _ABSENT_REVISION,
        f"Alembic revision after downgrade must be {_ABSENT_REVISION}",
    )

    inspector = inspect(sync_connection)
    tables = set(inspector.get_table_names())
    _require(
        "calendar_items" not in tables,
        "calendar_items survived downgrade to the previous revision",
    )
    _require("users" in tables, "users table disappeared during calendar downgrade")

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    _require(
        "ics_token" not in user_columns,
        "users.ics_token survived downgrade to the previous revision",
    )
    user_indexes = {
        index["name"]
        for index in inspector.get_indexes("users")
        if index.get("name")
    }
    _require(
        "ix_users_ics_token" not in user_indexes,
        "ix_users_ics_token survived downgrade to the previous revision",
    )


async def _main(expect: str) -> None:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    _require(bool(database_url), "DATABASE_URL is required")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            verifier = _verify_present if expect == "present" else _verify_absent
            await connection.run_sync(verifier)
    finally:
        await engine.dispose()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expect",
        choices=("present", "absent"),
        default="present",
        help="Expected state of the calendar migration relative to its revision.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = _parse_args()
    asyncio.run(_main(arguments.expect))
