"""payment_evidence + payment.lock_version + rejected status

Revision ID: w6payev01
Revises: w5warranty01
Create Date: 2026-07-21

Backward compatible:
- ADD COLUMN lock_version DEFAULT 0
- ADD ENUM value rejected (Postgres)
- CREATE TABLE payment_evidence

Rollback: downgrade drops table + leaves rejected enum (Postgres enum drop hard);
lock_version column dropped. Existing payments/history untouched beyond column drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "w6payev01"
down_revision: Union[str, Sequence[str], None] = "w5warranty01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute("ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS 'rejected'")

    cols = {c["name"] for c in insp.get_columns("payments")} if "payments" in insp.get_table_names() else set()
    if "lock_version" not in cols:
        op.add_column(
            "payments",
            sa.Column("lock_version", sa.Integer(), nullable=False, server_default="0"),
        )

    if "payment_evidence" not in insp.get_table_names():
        op.create_table(
            "payment_evidence",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id"), nullable=False, index=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("row_status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("claimed_amount", sa.Float(), nullable=False),
            sa.Column("transfer_date", sa.Date(), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("payment_reference", sa.String(255), nullable=True),
            sa.Column("storage_key", sa.String(512), nullable=False),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("mime_type", sa.String(128), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("checksum_sha256", sa.String(64), nullable=False),
            sa.Column("uploaded_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("idempotency_key", sa.String(128), nullable=True),
            sa.Column("antivirus_scanned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("reviewed_by", sa.String(36), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("reject_reason", sa.Text(), nullable=True),
            sa.UniqueConstraint("payment_id", "idempotency_key", name="uq_payment_evidence_idempotency"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "payment_evidence" in insp.get_table_names():
        op.drop_table("payment_evidence")
    cols = {c["name"] for c in insp.get_columns("payments")} if "payments" in insp.get_table_names() else set()
    if "lock_version" in cols:
        op.drop_column("payments", "lock_version")
    # Postgres: rejected enum value not removed
