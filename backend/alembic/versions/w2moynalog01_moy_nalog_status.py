"""User.moy_nalog_status honesty enum string

Revision ID: b2c3d4e5f6a7
Revises: z0a1b2c3d4e5
Create Date: 2026-07-21
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "w2moynalog01"
down_revision: Union[str, Sequence[str], None] = "w1softdelete01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("moy_nalog_status", sa.String(length=32), nullable=False, server_default="not_connected"),
    )


def downgrade() -> None:
    op.drop_column("users", "moy_nalog_status")
