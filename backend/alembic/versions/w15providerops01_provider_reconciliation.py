"""provider reconciliation runtime ledger

Revision ID: w15providerops01
Revises: w14techsupervision01
Create Date: 2026-08-21
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w15providerops01"
down_revision: str | None = "w14techsupervision01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "provider_reconciliations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("operation_type", sa.String(length=48), nullable=False),
        sa.Column("resource_type", sa.String(length=48), nullable=False),
        sa.Column("resource_id", sa.String(length=64), nullable=False),
        sa.Column("provider_resource_id", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_status", sa.String(length=64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("claim_generation", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("locked_by", sa.String(length=96), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'retry', 'completed', 'terminal', 'unavailable')",
            name="ck_provider_reconciliations_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "operation_type",
            "resource_type",
            "resource_id",
            name="uq_provider_reconciliation_resource",
        ),
    )
    for column in (
        "provider",
        "operation_type",
        "resource_type",
        "resource_id",
        "provider_resource_id",
        "status",
        "next_attempt_at",
        "locked_at",
        "expires_at",
        "created_at",
    ):
        op.create_index(
            f"ix_provider_reconciliations_{column}",
            "provider_reconciliations",
            [column],
            unique=False,
        )
    op.create_index(
        "ix_provider_reconciliations_due",
        "provider_reconciliations",
        ["status", "next_attempt_at", "locked_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_provider_reconciliations_due", table_name="provider_reconciliations")
    for column in reversed(
        (
            "provider",
            "operation_type",
            "resource_type",
            "resource_id",
            "provider_resource_id",
            "status",
            "next_attempt_at",
            "locked_at",
            "expires_at",
            "created_at",
        )
    ):
        op.drop_index(
            f"ix_provider_reconciliations_{column}",
            table_name="provider_reconciliations",
        )
    op.drop_table("provider_reconciliations")
