"""estimate_locked_at on projects

Revision ID: u5v6w7x8y9z0
"""
from alembic import op
import sqlalchemy as sa

revision = "u5v6w7x8y9z0"
down_revision = "t4u5v6w7x8y9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("estimate_locked_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "estimate_locked_at")
