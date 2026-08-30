"""align legacy VARCHAR status columns with canonical ORM enums

Revision ID: w16legacystatus01
Revises: w15providerops01
Create Date: 2026-08-28

Three tables predate their current ORM enum mappings and were intentionally
created as VARCHAR. PostgreSQL therefore rejects ORM writes that bind the
native enum types. Validate every existing value before changing storage so
an unexpected legacy value fails the migration instead of being coerced or
silently discarded.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "w16legacystatus01"
down_revision: str | None = "w15providerops01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_STATUS_ENUMS: tuple[tuple[str, str, tuple[str, ...], int], ...] = (
    (
        "purchases",
        "purchasestatus",
        ("draft", "approved", "ordered", "paid", "partial", "delivered", "cancelled", "returned"),
        32,
    ),
    (
        "material_picks",
        "materialpickstatus",
        ("draft", "pending", "approved", "purchased"),
        32,
    ),
    (
        "selection_items",
        "selectionstatus",
        ("draft", "proposed", "approved", "rejected"),
        16,
    ),
)


def _validate_existing_values(table: str, allowed: tuple[str, ...]) -> None:
    bind = op.get_bind()
    allowed_sql = ", ".join(f"'{value}'" for value in allowed)
    unexpected = list(
        bind.execute(
            sa.text(
                f"SELECT DISTINCT status FROM {table} "
                f"WHERE status IS NOT NULL AND status NOT IN ({allowed_sql}) "
                "ORDER BY status"
            )
        ).scalars()
    )
    if unexpected:
        raise RuntimeError(
            f"Refusing status enum migration for {table}: unexpected values {unexpected!r}"
        )


def upgrade() -> None:
    bind = op.get_bind()

    for table, enum_name, values, _length in _STATUS_ENUMS:
        _validate_existing_values(table, values)
        enum_type = postgresql.ENUM(*values, name=enum_name)
        enum_type.create(bind, checkfirst=True)
        op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN status DROP DEFAULT"))
        op.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN status TYPE {enum_name} "
                f"USING status::text::{enum_name}"
            )
        )
        op.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN status "
                f"SET DEFAULT 'draft'::{enum_name}"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()

    for table, enum_name, _values, length in reversed(_STATUS_ENUMS):
        op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN status DROP DEFAULT"))
        op.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN status TYPE VARCHAR({length}) "
                "USING status::text"
            )
        )
        op.execute(
            sa.text(
                f"ALTER TABLE {table} ALTER COLUMN status SET DEFAULT 'draft'"
            )
        )
        postgresql.ENUM(name=enum_name).drop(bind, checkfirst=True)
