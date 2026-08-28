"""align chat message PostgreSQL enum with the canonical ORM contract

Revision ID: w17chatmessageenum01
Revises: w16legacystatus01
Create Date: 2026-08-28

The original v14 schema created ``chatmessagetype`` with only
text/photo/confirm/system. The ORM and mobile contract later added
file/task/invoice/payment without a PostgreSQL enum migration. A real local
PostgreSQL startup exposed the mismatch when demo chat seeding attempted a
``task`` message.

Upgrade is intentionally fail-closed: only the exact historical enum or the
exact desired enum is accepted. Downgrade refuses to remove labels while any
row still uses one of the extended values, avoiding silent data loss.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w17chatmessageenum01"
down_revision: str | None = "w16legacystatus01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ENUM_NAME = "chatmessagetype"
_TABLE = "chat_messages"
_COLUMN = "message_type"
_LEGACY_VALUES = ("text", "photo", "confirm", "system")
_CURRENT_VALUES = (
    "text",
    "photo",
    "file",
    "confirm",
    "system",
    "task",
    "invoice",
    "payment",
)
_EXTENDED_VALUES = tuple(value for value in _CURRENT_VALUES if value not in _LEGACY_VALUES)


def _enum_values() -> tuple[str, ...]:
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
            {"enum_name": _ENUM_NAME},
        ).scalars()
    )


def _require_known_state(actual: tuple[str, ...]) -> None:
    if actual not in {_LEGACY_VALUES, _CURRENT_VALUES}:
        raise RuntimeError(
            f"Refusing {_ENUM_NAME} migration: expected legacy {_LEGACY_VALUES!r} "
            f"or current {_CURRENT_VALUES!r}, found {actual!r}"
        )


def upgrade() -> None:
    actual = _enum_values()
    _require_known_state(actual)
    if actual == _CURRENT_VALUES:
        return

    # Insert around stable legacy neighbours. Reverse insertion after `system`
    # yields the canonical ORM order task -> invoice -> payment.
    op.execute(sa.text(f"ALTER TYPE {_ENUM_NAME} ADD VALUE 'file' BEFORE 'confirm'"))
    op.execute(sa.text(f"ALTER TYPE {_ENUM_NAME} ADD VALUE 'payment' AFTER 'system'"))
    op.execute(sa.text(f"ALTER TYPE {_ENUM_NAME} ADD VALUE 'invoice' AFTER 'system'"))
    op.execute(sa.text(f"ALTER TYPE {_ENUM_NAME} ADD VALUE 'task' AFTER 'system'"))


def downgrade() -> None:
    actual = _enum_values()
    _require_known_state(actual)
    if actual == _LEGACY_VALUES:
        return

    bind = op.get_bind()
    extended_sql = ", ".join(f"'{value}'" for value in _EXTENDED_VALUES)
    used = tuple(
        bind.execute(
            sa.text(
                f"SELECT DISTINCT {_COLUMN}::text FROM {_TABLE} "
                f"WHERE {_COLUMN}::text IN ({extended_sql}) ORDER BY 1"
            )
        ).scalars()
    )
    if used:
        raise RuntimeError(
            f"Refusing {_ENUM_NAME} downgrade: extended values are still in use {used!r}"
        )

    op.execute(
        sa.text(
            f"ALTER TABLE {_TABLE} ALTER COLUMN {_COLUMN} TYPE TEXT "
            f"USING {_COLUMN}::text"
        )
    )
    op.execute(sa.text(f"DROP TYPE {_ENUM_NAME}"))
    legacy_sql = ", ".join(f"'{value}'" for value in _LEGACY_VALUES)
    op.execute(sa.text(f"CREATE TYPE {_ENUM_NAME} AS ENUM ({legacy_sql})"))
    op.execute(
        sa.text(
            f"ALTER TABLE {_TABLE} ALTER COLUMN {_COLUMN} TYPE {_ENUM_NAME} "
            f"USING {_COLUMN}::{_ENUM_NAME}"
        )
    )
