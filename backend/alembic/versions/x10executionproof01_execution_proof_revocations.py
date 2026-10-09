"""Persistent execution proof revocation ledger.

Revision ID: x10executionproof01
Revises: x09selectionqty01
"""
from alembic import op
import sqlalchemy as sa

revision = "x10executionproof01"
down_revision = "x09selectionqty01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "execution_proof_revocations",
        sa.Column("checkpoint_sha256", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("revoked_by", sa.String(length=64), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("checkpoint_sha256"),
    )
    op.create_index(
        "ix_execution_proof_revocations_revoked_at",
        "execution_proof_revocations",
        ["revoked_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_execution_proof_revocations_revoked_at", table_name="execution_proof_revocations")
    op.drop_table("execution_proof_revocations")
