"""close the remaining verified PostgreSQL native-enum parity drift

Revision ID: w18nativeenumparity01
Revises: w17chatmessageenum01
Create Date: 2026-08-28

The generic ORM/PostgreSQL enum verifier introduced with w17 exposed exactly
three remaining historical mismatches on a clean database:

* ``app_notifications.notification_type`` had only the original v14 labels
  plus ``payment_confirmed`` while the ORM accumulated additional product
  notification types without migrations;
* ``job_leads.status`` was deliberately materialized as VARCHAR(32) in the
  legacy catch-up migration although the ORM now binds native JobLeadStatus;
* ``payments.status`` had the same labels as the ORM but PostgreSQL retained
  the incidental append order from ALTER TYPE ADD VALUE history.

This migration accepts only the exact known historical/current states and
validates persisted row values before rebuilding types. It does not infer or
coerce unknown values.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "w18nativeenumparity01"
down_revision: str | None = "w17chatmessageenum01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOTIFICATION_ENUM = "notificationtype"
_NOTIFICATION_LEGACY = (
    "stage_review",
    "payment_pending",
    "change_order",
    "room_change",
    "chat_message",
    "payment_confirmed",
)
_NOTIFICATION_CURRENT = (
    "stage_review",
    "stage_started",
    "room_updated",
    "room_created",
    "payment_pending",
    "payment_confirmed",
    "change_order",
    "room_change",
    "chat_message",
    "budget_alert",
    "reaction",
    "materials",
    "approval",
    "issue",
    "deadline",
    "waste_reminder",
    "document",
    "other",
)

_PAYMENT_ENUM = "paymentstatus"
_PAYMENT_LEGACY = (
    "pending",
    "confirmed",
    "cancelled",
    "processing",
    "paid_unverified",
    "disputed",
    "refunded",
)
_PAYMENT_CURRENT = (
    "pending",
    "processing",
    "paid_unverified",
    "confirmed",
    "cancelled",
    "disputed",
    "refunded",
)

_JOB_LEAD_ENUM = "jobleadstatus"
_JOB_LEAD_CURRENT = ("open", "quoted", "taken", "closed")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def _enum_values(enum_name: str) -> tuple[str, ...]:
    bind = op.get_bind()
    return tuple(
        bind.execute(
            sa.text(
                """
                SELECT enumlabel
                FROM pg_enum
                JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
                WHERE pg_type.typname = :enum_name
                ORDER BY enumsortorder
                """
            ),
            {"enum_name": enum_name},
        ).scalars()
    )


def _column_udt(table: str, column: str) -> str | None:
    bind = op.get_bind()
    return bind.execute(
        sa.text(
            """
            SELECT udt_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = :table
              AND column_name = :column
            """
        ),
        {"table": table, "column": column},
    ).scalar_one_or_none()


def _distinct_values(table: str, column: str) -> tuple[str, ...]:
    bind = op.get_bind()
    return tuple(
        bind.execute(
            sa.text(
                f"SELECT DISTINCT {column}::text FROM {table} "
                f"WHERE {column} IS NOT NULL ORDER BY 1"
            )
        ).scalars()
    )


def _require_row_values(table: str, column: str, allowed: tuple[str, ...]) -> None:
    actual = _distinct_values(table, column)
    unexpected = tuple(value for value in actual if value not in allowed)
    if unexpected:
        raise RuntimeError(
            f"Refusing enum parity migration for {table}.{column}: "
            f"unexpected persisted values {unexpected!r}; allowed={allowed!r}"
        )


def _create_enum(enum_name: str, values: tuple[str, ...]) -> None:
    op.execute(sa.text(f"CREATE TYPE {enum_name} AS ENUM ({_quoted(values)})"))


def _rebuild_enum_column(
    *,
    table: str,
    column: str,
    enum_name: str,
    accepted_source: tuple[str, ...],
    target: tuple[str, ...],
) -> None:
    actual = _enum_values(enum_name)
    if actual == target:
        if _column_udt(table, column) != enum_name:
            raise RuntimeError(
                f"{table}.{column} is not bound to existing {enum_name}: "
                f"udt={_column_udt(table, column)!r}"
            )
        return
    if actual != accepted_source:
        raise RuntimeError(
            f"Refusing {enum_name} rebuild: expected source {accepted_source!r} "
            f"or target {target!r}, found {actual!r}"
        )
    if _column_udt(table, column) != enum_name:
        raise RuntimeError(
            f"Refusing {enum_name} rebuild: {table}.{column} uses "
            f"{_column_udt(table, column)!r}"
        )

    _require_row_values(table, column, target)
    op.execute(
        sa.text(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE TEXT "
            f"USING {column}::text"
        )
    )
    op.execute(sa.text(f"DROP TYPE {enum_name}"))
    _create_enum(enum_name, target)
    op.execute(
        sa.text(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {enum_name} "
            f"USING {column}::{enum_name}"
        )
    )


def _upgrade_job_lead_status() -> None:
    table = "job_leads"
    column = "status"
    current_udt = _column_udt(table, column)
    existing_enum = _enum_values(_JOB_LEAD_ENUM)

    if current_udt == _JOB_LEAD_ENUM:
        if existing_enum != _JOB_LEAD_CURRENT:
            raise RuntimeError(
                f"Refusing {_JOB_LEAD_ENUM} migration: expected {_JOB_LEAD_CURRENT!r}, "
                f"found {existing_enum!r}"
            )
        return
    if current_udt != "varchar":
        raise RuntimeError(
            f"Refusing {_JOB_LEAD_ENUM} migration: {table}.{column} uses {current_udt!r}"
        )
    if existing_enum and existing_enum != _JOB_LEAD_CURRENT:
        raise RuntimeError(
            f"Refusing {_JOB_LEAD_ENUM} migration: unexpected pre-existing enum "
            f"{existing_enum!r}"
        )

    _require_row_values(table, column, _JOB_LEAD_CURRENT)
    if not existing_enum:
        postgresql.ENUM(*_JOB_LEAD_CURRENT, name=_JOB_LEAD_ENUM).create(
            op.get_bind(), checkfirst=True
        )
    op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP DEFAULT"))
    op.execute(
        sa.text(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {_JOB_LEAD_ENUM} "
            f"USING {column}::text::{_JOB_LEAD_ENUM}"
        )
    )
    op.execute(
        sa.text(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f"SET DEFAULT 'open'::{_JOB_LEAD_ENUM}"
        )
    )


def upgrade() -> None:
    _rebuild_enum_column(
        table="app_notifications",
        column="notification_type",
        enum_name=_NOTIFICATION_ENUM,
        accepted_source=_NOTIFICATION_LEGACY,
        target=_NOTIFICATION_CURRENT,
    )
    _rebuild_enum_column(
        table="payments",
        column="status",
        enum_name=_PAYMENT_ENUM,
        accepted_source=_PAYMENT_LEGACY,
        target=_PAYMENT_CURRENT,
    )
    _upgrade_job_lead_status()


def downgrade() -> None:
    # JobLead enum -> the historical VARCHAR(32) contract. Values are preserved.
    if _column_udt("job_leads", "status") == _JOB_LEAD_ENUM:
        op.execute(sa.text("ALTER TABLE job_leads ALTER COLUMN status DROP DEFAULT"))
        op.execute(
            sa.text(
                "ALTER TABLE job_leads ALTER COLUMN status TYPE VARCHAR(32) "
                "USING status::text"
            )
        )
        op.execute(sa.text("ALTER TABLE job_leads ALTER COLUMN status SET DEFAULT 'open'"))
        postgresql.ENUM(name=_JOB_LEAD_ENUM).drop(op.get_bind(), checkfirst=True)

    # Payment downgrade is lossless because legacy/current contain the same labels;
    # only the historical PostgreSQL enum ordering differs.
    _rebuild_enum_column(
        table="payments",
        column="status",
        enum_name=_PAYMENT_ENUM,
        accepted_source=_PAYMENT_CURRENT,
        target=_PAYMENT_LEGACY,
    )

    # Removing notification labels is safe only if no persisted row uses them.
    _require_row_values("app_notifications", "notification_type", _NOTIFICATION_LEGACY)
    _rebuild_enum_column(
        table="app_notifications",
        column="notification_type",
        enum_name=_NOTIFICATION_ENUM,
        accepted_source=_NOTIFICATION_CURRENT,
        target=_NOTIFICATION_LEGACY,
    )
