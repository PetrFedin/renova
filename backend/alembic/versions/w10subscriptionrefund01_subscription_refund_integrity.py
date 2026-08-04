"""Persist subscription refund ledger and reversible entitlement snapshots.

Revision ID: w10subscriptionrefund01
Revises: w9subscriptioncheckout01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "w10subscriptionrefund01"
down_revision = "w9subscriptioncheckout01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscription_checkouts",
        sa.Column("entitlement_before_status", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "subscription_checkouts",
        sa.Column("entitlement_before_plan", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "subscription_checkouts",
        sa.Column("entitlement_before_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "subscription_checkouts",
        sa.Column("entitlement_after_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "subscription_checkouts",
        sa.Column(
            "refunded_amount",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "subscription_checkouts",
        sa.Column("entitlement_reversed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "subscription_refunds",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("checkout_id", sa.String(length=36), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("provider_refund_id", sa.String(length=128), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=128), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("entitlement_changed", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["checkout_id"], ["subscription_checkouts.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_subscription_refunds_checkout_id",
        "subscription_refunds",
        ["checkout_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_user_id",
        "subscription_refunds",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_provider_refund_id",
        "subscription_refunds",
        ["provider_refund_id"],
        unique=True,
    )
    op.create_index(
        "ix_subscription_refunds_provider_payment_id",
        "subscription_refunds",
        ["provider_payment_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_status",
        "subscription_refunds",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_subscription_refunds_status", table_name="subscription_refunds")
    op.drop_index(
        "ix_subscription_refunds_provider_payment_id",
        table_name="subscription_refunds",
    )
    op.drop_index(
        "ix_subscription_refunds_provider_refund_id",
        table_name="subscription_refunds",
    )
    op.drop_index("ix_subscription_refunds_user_id", table_name="subscription_refunds")
    op.drop_index("ix_subscription_refunds_checkout_id", table_name="subscription_refunds")
    op.drop_table("subscription_refunds")

    op.drop_column("subscription_checkouts", "entitlement_reversed_at")
    op.drop_column("subscription_checkouts", "refunded_amount")
    op.drop_column("subscription_checkouts", "entitlement_after_expires_at")
    op.drop_column("subscription_checkouts", "entitlement_before_expires_at")
    op.drop_column("subscription_checkouts", "entitlement_before_plan")
    op.drop_column("subscription_checkouts", "entitlement_before_status")
