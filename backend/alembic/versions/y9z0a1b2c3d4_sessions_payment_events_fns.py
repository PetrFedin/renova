"""Auth sessions, payment events/webhook idempotency, FNS verification_status

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-07-21
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "y9z0a1b2c3d4"
down_revision: Union[str, Sequence[str], None] = "x8y9z0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("refresh_token_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(255), nullable=True),
    )
    op.create_table(
        "payment_webhook_events",
        sa.Column("event_id", sa.String(128), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False, server_default="yookassa"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("payload_kind", sa.String(64), nullable=True),
    )
    op.create_table(
        "payment_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id"), nullable=False, index=True),
        sa.Column("actor_user_id", sa.String(36), nullable=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("old_status", sa.String(32), nullable=True),
        sa.Column("new_status", sa.String(32), nullable=False),
        sa.Column("evidence_type", sa.String(32), nullable=True),
        sa.Column("evidence_ref", sa.String(128), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.add_column(
        "receipts",
        sa.Column("verification_status", sa.String(32), nullable=False, server_default="saved_unverified"),
    )
    op.add_column(
        "payments",
        sa.Column("payment_method", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payments", "payment_method")
    op.drop_column("receipts", "verification_status")
    op.drop_table("payment_events")
    op.drop_table("payment_webhook_events")
    op.drop_table("user_sessions")
