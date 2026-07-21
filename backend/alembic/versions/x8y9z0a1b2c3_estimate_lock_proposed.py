"""W57: estimate_lock_proposed_at/by for mutual lock

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-19
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "x8y9z0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "w7x8y9z0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("estimate_lock_proposed_at", sa.DateTime(), nullable=True))
    op.add_column("projects", sa.Column("estimate_lock_proposed_by", sa.String(length=36), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "estimate_lock_proposed_by")
    op.drop_column("projects", "estimate_lock_proposed_at")
