"""add authoritative versioned manual-payment evidence

Revision ID: w19paymentevidence01
Revises: w18nativeenumparity01
Create Date: 2026-09-04
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w19paymentevidence01"
down_revision: str | None = "w18nativeenumparity01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payment_evidence",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("payment_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("declared_content_type", sa.String(length=96), nullable=False),
        sa.Column("verified_content_type", sa.String(length=96), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("submitted_by", sa.String(length=36), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_by", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("byte_size IS NULL OR byte_size > 0", name="ck_payment_evidence_byte_size_positive"),
        sa.CheckConstraint("status IN ('upload_pending','submitted','rejected','approved')", name="ck_payment_evidence_status"),
        sa.CheckConstraint("version > 0", name="ck_payment_evidence_version_positive"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_id", "version", name="uq_payment_evidence_payment_version"),
        sa.UniqueConstraint("storage_key", name="uq_payment_evidence_storage_key"),
    )
    op.create_index(op.f("ix_payment_evidence_payment_id"), "payment_evidence", ["payment_id"], unique=False)
    op.create_index(op.f("ix_payment_evidence_project_id"), "payment_evidence", ["project_id"], unique=False)
    op.create_index(op.f("ix_payment_evidence_reviewed_by"), "payment_evidence", ["reviewed_by"], unique=False)
    op.create_index(op.f("ix_payment_evidence_status"), "payment_evidence", ["status"], unique=False)
    op.create_index(op.f("ix_payment_evidence_submitted_by"), "payment_evidence", ["submitted_by"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_payment_evidence_submitted_by"), table_name="payment_evidence")
    op.drop_index(op.f("ix_payment_evidence_status"), table_name="payment_evidence")
    op.drop_index(op.f("ix_payment_evidence_reviewed_by"), table_name="payment_evidence")
    op.drop_index(op.f("ix_payment_evidence_project_id"), table_name="payment_evidence")
    op.drop_index(op.f("ix_payment_evidence_payment_id"), table_name="payment_evidence")
    op.drop_table("payment_evidence")
