"""Durable project-payment provider partial/full refund ledger (#748).

Revision ID: x12projectrefund01
Revises: x11portalacceptscope01
"""
from alembic import op
import sqlalchemy as sa

revision = "x12projectrefund01"
down_revision = "x11portalacceptscope01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_payment_refunds",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("payment_id", sa.String(length=36), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=128), nullable=False),
        sa.Column("provider_refund_id", sa.String(length=128), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_project_payment_refund_positive"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_refund_id", name="uq_project_payment_refunds_provider_refund_id"),
    )
    op.create_index(
        "ix_project_payment_refunds_project_id", "project_payment_refunds", ["project_id"]
    )
    op.create_index(
        "ix_project_payment_refunds_payment_id", "project_payment_refunds", ["payment_id"]
    )
    op.create_index(
        "ix_project_payment_refunds_provider_payment_id",
        "project_payment_refunds", ["provider_payment_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_payment_refunds_provider_payment_id", table_name="project_payment_refunds")
    op.drop_index("ix_project_payment_refunds_payment_id", table_name="project_payment_refunds")
    op.drop_index("ix_project_payment_refunds_project_id", table_name="project_payment_refunds")
    op.drop_table("project_payment_refunds")
