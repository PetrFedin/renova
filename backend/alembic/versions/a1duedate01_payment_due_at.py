"""Payment.due_at — срок оплаты счёта

Revision ID: a1duedate01
Revises: w22projectparticipants01
Create Date: 2026-09-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1duedate01"
down_revision: Union[str, Sequence[str], None] = "w22projectparticipants01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("due_at", sa.DateTime(), nullable=True))
    op.create_index("ix_payments_due_at", "payments", ["due_at"])


def downgrade() -> None:
    op.drop_index("ix_payments_due_at", table_name="payments")
    op.drop_column("payments", "due_at")
