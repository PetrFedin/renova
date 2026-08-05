"""Add an auditable operator workflow for subscription refund reviews.

Revision ID: w11refundreview01
Revises: w10subscriptionrefund01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "w11refundreview01"
down_revision = "w10subscriptionrefund01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscription_refunds",
        sa.Column(
            "review_status",
            sa.String(length=24),
            nullable=False,
            server_default="not_required",
        ),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("review_owner_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("review_claimed_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("review_claim_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column(
            "review_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("resolution", sa.String(length=48), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("resolution_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("decision_key", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("reviewed_by_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "subscription_refunds",
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
    )

    op.create_foreign_key(
        "fk_subscription_refunds_review_owner_id_users",
        "subscription_refunds",
        "users",
        ["review_owner_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_subscription_refunds_reviewed_by_id_users",
        "subscription_refunds",
        "users",
        ["reviewed_by_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_subscription_refunds_decision_key",
        "subscription_refunds",
        ["decision_key"],
    )
    op.create_index(
        "ix_subscription_refunds_review_status",
        "subscription_refunds",
        ["review_status"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_review_owner_id",
        "subscription_refunds",
        ["review_owner_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_review_claim_expires_at",
        "subscription_refunds",
        ["review_claim_expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refunds_reviewed_by_id",
        "subscription_refunds",
        ["reviewed_by_id"],
        unique=False,
    )
    op.execute(
        "UPDATE subscription_refunds "
        "SET review_status = 'open' "
        "WHERE status = 'manual_review'"
    )

    op.create_table(
        "subscription_refund_review_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("refund_id", sa.String(length=36), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["refund_id"],
            ["subscription_refunds.id"],
            name="fk_refund_review_events_refund_id",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name="fk_refund_review_events_actor_id",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_subscription_refund_review_events_refund_id",
        "subscription_refund_review_events",
        ["refund_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refund_review_events_actor_id",
        "subscription_refund_review_events",
        ["actor_id"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refund_review_events_event_type",
        "subscription_refund_review_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        "ix_subscription_refund_review_events_created_at",
        "subscription_refund_review_events",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_subscription_refund_review_events_created_at",
        table_name="subscription_refund_review_events",
    )
    op.drop_index(
        "ix_subscription_refund_review_events_event_type",
        table_name="subscription_refund_review_events",
    )
    op.drop_index(
        "ix_subscription_refund_review_events_actor_id",
        table_name="subscription_refund_review_events",
    )
    op.drop_index(
        "ix_subscription_refund_review_events_refund_id",
        table_name="subscription_refund_review_events",
    )
    op.drop_table("subscription_refund_review_events")

    op.drop_index("ix_subscription_refunds_reviewed_by_id", table_name="subscription_refunds")
    op.drop_index(
        "ix_subscription_refunds_review_claim_expires_at",
        table_name="subscription_refunds",
    )
    op.drop_index("ix_subscription_refunds_review_owner_id", table_name="subscription_refunds")
    op.drop_index("ix_subscription_refunds_review_status", table_name="subscription_refunds")
    op.drop_constraint(
        "uq_subscription_refunds_decision_key",
        "subscription_refunds",
        type_="unique",
    )
    op.drop_constraint(
        "fk_subscription_refunds_reviewed_by_id_users",
        "subscription_refunds",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_subscription_refunds_review_owner_id_users",
        "subscription_refunds",
        type_="foreignkey",
    )
    op.drop_column("subscription_refunds", "reviewed_at")
    op.drop_column("subscription_refunds", "reviewed_by_id")
    op.drop_column("subscription_refunds", "decision_key")
    op.drop_column("subscription_refunds", "resolution_note")
    op.drop_column("subscription_refunds", "resolution")
    op.drop_column("subscription_refunds", "review_version")
    op.drop_column("subscription_refunds", "review_claim_expires_at")
    op.drop_column("subscription_refunds", "review_claimed_at")
    op.drop_column("subscription_refunds", "review_owner_id")
    op.drop_column("subscription_refunds", "review_status")
