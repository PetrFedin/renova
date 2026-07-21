"""Soft-delete users + job_lead_quotes

Revision ID: a1b2c3d4e5f6
Revises: z0a1b2c3d4e5
Create Date: 2026-07-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "z0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deletion_requested_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    try:
        op.create_index("ix_users_deleted_at", "users", ["deleted_at"])
    except Exception:
        pass
    op.create_table(
        "job_lead_quotes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("lead_id", sa.String(36), sa.ForeignKey("job_leads.id"), nullable=False, index=True),
        sa.Column("contractor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("pre_estimate", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("lead_id", "contractor_id", name="uq_lead_contractor_quote"),
    )


def downgrade() -> None:
    op.drop_table("job_lead_quotes")
    try:
        op.drop_index("ix_users_deleted_at", "users")
    except Exception:
        pass
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "deletion_requested_at")
