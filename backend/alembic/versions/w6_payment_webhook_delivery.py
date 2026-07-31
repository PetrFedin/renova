"""durable payment webhook delivery claims

Revision ID: w6webhookdelivery01
Revises: w7codoclink001
"""

from alembic import op
import sqlalchemy as sa


revision = "w6webhookdelivery01"
down_revision = "w7codoclink001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_webhook_deliveries",
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("event_kind", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("locked_by", sa.String(length=96), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("outcome", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index(
        "ix_payment_webhook_deliveries_locked_at",
        "payment_webhook_deliveries",
        ["locked_at"],
    )
    op.create_index(
        "ix_payment_webhook_deliveries_next_attempt_at",
        "payment_webhook_deliveries",
        ["next_attempt_at"],
    )
    op.create_index(
        "ix_payment_webhook_deliveries_completed_at",
        "payment_webhook_deliveries",
        ["completed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_payment_webhook_deliveries_completed_at",
        table_name="payment_webhook_deliveries",
    )
    op.drop_index(
        "ix_payment_webhook_deliveries_next_attempt_at",
        table_name="payment_webhook_deliveries",
    )
    op.drop_index(
        "ix_payment_webhook_deliveries_locked_at",
        table_name="payment_webhook_deliveries",
    )
    op.drop_table("payment_webhook_deliveries")
