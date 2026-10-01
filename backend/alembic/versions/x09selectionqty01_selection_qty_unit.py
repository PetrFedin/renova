"""selection_items.qty/unit: proposer-supplied quantity (EST-013)

Revision ID: x09selectionqty01
Revises: x08schemadrift01
"""
from alembic import op
import sqlalchemy as sa


revision = "x09selectionqty01"
down_revision = "x08schemadrift01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("selection_items", sa.Column("qty", sa.Float(), nullable=True))
    op.add_column("selection_items", sa.Column("unit", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("selection_items", "unit")
    op.drop_column("selection_items", "qty")
