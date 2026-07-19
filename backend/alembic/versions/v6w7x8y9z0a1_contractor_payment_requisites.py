"""contractor payment_requisites for honest SBP transfer

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v6w7x8y9z0a1"
down_revision: Union[str, None] = "u5v6w7x8y9z0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contractor_profiles", sa.Column("payment_requisites", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("contractor_profiles", "payment_requisites")
