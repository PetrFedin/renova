"""payments.yookassa_payment_id for live checkout webhook

Revision ID: q1r2s3t4u5v6
Revises: p6q7r8s9t0u1
"""
from alembic import op
import sqlalchemy as sa

revision = "q1r2s3t4u5v6"
down_revision = "p6q7r8s9t0u1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("yookassa_payment_id", sa.String(length=64), nullable=True))
    op.create_index("ix_payments_yookassa_payment_id", "payments", ["yookassa_payment_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_payments_yookassa_payment_id", table_name="payments")
    op.drop_column("payments", "yookassa_payment_id")
