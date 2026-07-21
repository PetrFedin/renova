"""add payment_confirmed notification enum value

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-07-19
"""
from typing import Sequence, Union

from alembic import op

revision: str = "w7x8y9z0a1b2"
down_revision: Union[str, Sequence[str], None] = "v6w7x8y9z0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'payment_confirmed'")


def downgrade() -> None:
    # PostgreSQL does not support dropping enum values safely in place.
    return None
