"""room is_archived

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
"""
from alembic import op
import sqlalchemy as sa

revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("rooms", "is_archived")
