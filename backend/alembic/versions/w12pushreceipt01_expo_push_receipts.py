"""Add durable Expo push receipt reconciliation state.

Revision ID: w12pushreceipt01
Revises: w11refundreview01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "w12pushreceipt01"
down_revision = "w11refundreview01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expo_push_receipts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("expo_receipt_id", sa.String(length=128), nullable=False),
        sa.Column("push_token_id", sa.String(length=36), nullable=True),
        sa.Column("token_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("delivery_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("provider_error", sa.String(length=64), nullable=True),
        sa.Column("provider_message", sa.Text(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("locked_by", sa.String(length=96), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["push_token_id"],
            ["push_tokens.id"],
            name="fk_expo_push_receipts_push_token_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_expo_push_receipts"),
    )
    op.create_index(
        "ux_expo_push_receipts_receipt_id",
        "expo_push_receipts",
        ["expo_receipt_id"],
        unique=True,
    )
    op.create_index("ix_expo_push_receipts_push_token_id", "expo_push_receipts", ["push_token_id"])
    op.create_index("ix_expo_push_receipts_delivery_id", "expo_push_receipts", ["delivery_id"])
    op.create_index("ix_expo_push_receipts_status", "expo_push_receipts", ["status"])
    op.create_index("ix_expo_push_receipts_next_attempt_at", "expo_push_receipts", ["next_attempt_at"])
    op.create_index("ix_expo_push_receipts_locked_at", "expo_push_receipts", ["locked_at"])
    op.create_index("ix_expo_push_receipts_expires_at", "expo_push_receipts", ["expires_at"])
    op.create_index("ix_expo_push_receipts_created_at", "expo_push_receipts", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_expo_push_receipts_created_at", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_expires_at", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_locked_at", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_next_attempt_at", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_status", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_delivery_id", table_name="expo_push_receipts")
    op.drop_index("ix_expo_push_receipts_push_token_id", table_name="expo_push_receipts")
    op.drop_index("ux_expo_push_receipts_receipt_id", table_name="expo_push_receipts")
    op.drop_table("expo_push_receipts")
