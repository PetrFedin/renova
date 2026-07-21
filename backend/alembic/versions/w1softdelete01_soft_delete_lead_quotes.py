"""Soft-delete users + job_lead_quotes

Revision ID: w1softdelete01
Revises: z0a1b2c3d4e5
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "w1softdelete01"
down_revision: Union[str, Sequence[str], None] = "z0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    # Soft-delete columns (idempotent for DBs that already have them via create_all)
    user_cols = {c["name"] for c in insp.get_columns("users")} if "users" in tables else set()
    if "deletion_requested_at" not in user_cols:
        op.add_column("users", sa.Column("deletion_requested_at", sa.DateTime(), nullable=True))
    if "deleted_at" not in user_cols:
        op.add_column("users", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    try:
        op.create_index("ix_users_deleted_at", "users", ["deleted_at"])
    except Exception:
        pass

    # job_leads historically lived only in create_all / SQLite — ensure PG has the table
    if "job_leads" not in tables:
        op.create_table(
            "job_leads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("area_sqm", sa.Float(), nullable=True),
            sa.Column("renovation_type", sa.String(32), server_default="cosmetic", nullable=False),
            sa.Column("budget_hint", sa.Float(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(32), server_default="open", nullable=False),
            sa.Column("pre_estimate", sa.Float(), nullable=True),
            sa.Column("assigned_contractor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    if "job_lead_quotes" not in tables:
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
    insp = inspect(op.get_bind())
    tables = set(insp.get_table_names())
    if "job_lead_quotes" in tables:
        op.drop_table("job_lead_quotes")
    # do not drop job_leads — may contain product data if created earlier
    try:
        op.drop_index("ix_users_deleted_at", "users")
    except Exception:
        pass
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "deletion_requested_at")
