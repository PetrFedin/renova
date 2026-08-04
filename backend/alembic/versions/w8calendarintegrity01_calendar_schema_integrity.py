"""Materialize calendar persistence and per-user ICS feed tokens.

Revision ID: w8calendarintegrity01
Revises: w6webhookdelivery01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "w8calendarintegrity01"
down_revision = "w6webhookdelivery01"
branch_labels = None
depends_on = None


_CALENDAR_INDEXES: dict[str, list[str]] = {
    "ix_calendar_items_user_id": ["user_id"],
    "ix_calendar_items_project_id": ["project_id"],
    "ix_calendar_items_stage_id": ["stage_id"],
    "ix_calendar_items_start_at": ["start_at"],
    "ix_calendar_items_end_at": ["end_at"],
    "ix_calendar_items_event_type": ["event_type"],
    "ix_calendar_items_is_public": ["is_public"],
    "ix_calendar_items_reminder_at": ["reminder_at"],
}

_EXPECTED_CALENDAR_COLUMNS = {
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


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _column_names(table_name: str) -> set[str]:
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in _inspector().get_indexes(table_name)
        if index.get("name")
    }


def _foreign_key_columns(table_name: str) -> set[tuple[str, ...]]:
    return {
        tuple(foreign_key.get("constrained_columns") or [])
        for foreign_key in _inspector().get_foreign_keys(table_name)
    }


def _create_calendar_table() -> None:
    op.create_table(
        "calendar_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("stage_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("recurrence", sa.String(length=128), nullable=True),
        sa.Column("location", sa.String(length=500), nullable=True),
        sa.Column("reminder_at", sa.DateTime(), nullable=True),
        sa.Column("reminder_sent", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_calendar_items_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_calendar_items_project_id_projects",
        ),
        sa.ForeignKeyConstraint(
            ["stage_id"],
            ["stages.id"],
            name="fk_calendar_items_stage_id_stages",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_calendar_items"),
    )


def _reconcile_existing_calendar_table() -> None:
    columns = _column_names("calendar_items")
    missing_columns = _EXPECTED_CALENDAR_COLUMNS - columns
    if missing_columns:
        raise RuntimeError(
            "calendar_items exists with an unsupported partial schema; "
            f"missing columns: {sorted(missing_columns)}"
        )

    primary_key = _inspector().get_pk_constraint("calendar_items")
    if list(primary_key.get("constrained_columns") or []) != ["id"]:
        raise RuntimeError("calendar_items must have id as its primary key")

    existing_foreign_keys = _foreign_key_columns("calendar_items")
    expected_foreign_keys = {
        ("user_id",): (
            "fk_calendar_items_user_id_users",
            "users",
        ),
        ("project_id",): (
            "fk_calendar_items_project_id_projects",
            "projects",
        ),
        ("stage_id",): (
            "fk_calendar_items_stage_id_stages",
            "stages",
        ),
    }
    for columns_tuple, (constraint_name, referred_table) in expected_foreign_keys.items():
        if columns_tuple not in existing_foreign_keys:
            op.create_foreign_key(
                constraint_name,
                "calendar_items",
                referred_table,
                list(columns_tuple),
                ["id"],
            )


def upgrade() -> None:
    tables = set(_inspector().get_table_names())

    if "ics_token" not in _column_names("users"):
        op.add_column(
            "users",
            sa.Column("ics_token", sa.String(length=128), nullable=True),
        )
    if "ix_users_ics_token" not in _index_names("users"):
        op.create_index(
            "ix_users_ics_token",
            "users",
            ["ics_token"],
            unique=True,
        )

    if "calendar_items" not in tables:
        _create_calendar_table()
    else:
        _reconcile_existing_calendar_table()

    existing_indexes = _index_names("calendar_items")
    for index_name, columns in _CALENDAR_INDEXES.items():
        if index_name not in existing_indexes:
            op.create_index(
                index_name,
                "calendar_items",
                columns,
                unique=False,
            )


def downgrade() -> None:
    tables = set(_inspector().get_table_names())
    if "calendar_items" in tables:
        op.drop_table("calendar_items")

    if "users" in tables:
        if "ix_users_ics_token" in _index_names("users"):
            op.drop_index("ix_users_ics_token", table_name="users")
        if "ics_token" in _column_names("users"):
            op.drop_column("users", "ics_token")
