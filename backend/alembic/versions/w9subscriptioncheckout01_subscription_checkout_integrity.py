"""Persist idempotent Renova Pro renewal checkout cycles.

Revision ID: w9subscriptioncheckout01
Revises: w8calendarintegrity01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "w9subscriptioncheckout01"
down_revision = "w8calendarintegrity01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_checkouts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("open_key", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("idempotence_key", sa.String(length=80), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=128), nullable=True),
        sa.Column("confirmation_url", sa.String(length=1024), nullable=True),
        sa.Column("provider_status", sa.String(length=32), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("replay_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotence_key", name="uq_subscription_checkout_idempotence_key"),
        sa.UniqueConstraint("open_key", name="uq_subscription_checkout_open_key"),
    )
    op.create_index(
        "ix_subscription_checkouts_user_id",
        "subscription_checkouts",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_checkouts_status",
        "subscription_checkouts",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_checkouts_provider_payment_id",
        "subscription_checkouts",
        ["provider_payment_id"],
        unique=True,
    )
    op.create_index(
        "ix_subscription_checkouts_replay_until",
        "subscription_checkouts",
        ["replay_until"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_subscription_checkouts_replay_until", table_name="subscription_checkouts")
    op.drop_index("ix_subscription_checkouts_provider_payment_id", table_name="subscription_checkouts")
    op.drop_index("ix_subscription_checkouts_status", table_name="subscription_checkouts")
    op.drop_index("ix_subscription_checkouts_user_id", table_name="subscription_checkouts")
    op.drop_table("subscription_checkouts")
