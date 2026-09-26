"""add change_order payment type

Доп. работы увеличивали план проекта, но не порождали ни одного счёта:
этапные платежи считаются из stage.payment_amount, а у ДО нет этапа.

Revision ID: w23changeorderpayment01
Revises: w22projectparticipants01
Create Date: 2026-09-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w23changeorderpayment01"
down_revision: Union[str, Sequence[str], None] = "w22projectparticipants01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE paymenttype ADD VALUE IF NOT EXISTS 'change_order'")
    op.add_column("payments", sa.Column("change_order_id", sa.String(length=36), nullable=True))
    op.create_index("ix_payments_change_order_id", "payments", ["change_order_id"], unique=True)
    op.create_foreign_key(
        "fk_payments_change_order_id",
        "payments",
        "change_orders",
        ["change_order_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # PostgreSQL does not support dropping enum values safely in place;
    # the added column is reversible on its own.
    op.drop_constraint("fk_payments_change_order_id", "payments", type_="foreignkey")
    op.drop_index("ix_payments_change_order_id", table_name="payments")
    op.drop_column("payments", "change_order_id")
