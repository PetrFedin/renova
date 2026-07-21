"""PaymentStatus: processing, paid_unverified, disputed, refunded

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-07-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "z0a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "y9z0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in ("processing", "paid_unverified", "disputed", "refunded"):
            op.execute(f"ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Postgres enum values are not easily removable
    pass
