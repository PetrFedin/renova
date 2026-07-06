"""receipts.payment_id — связь чека со счётом на оплату

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
"""
from alembic import op
import sqlalchemy as sa

revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "receipts",
        sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id"), nullable=True),
    )
    op.create_index("ix_receipts_payment_id", "receipts", ["payment_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_receipts_payment_id", table_name="receipts")
    op.drop_column("receipts", "payment_id")
