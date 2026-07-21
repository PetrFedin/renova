"""project archive + trash lifecycle

Revision ID: t4u5v6w7x8y9
"""
from alembic import op
import sqlalchemy as sa

revision = "t4u5v6w7x8y9"
down_revision = "s3t4u5v6w7x8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("projects", sa.Column("trashed_at", sa.DateTime(), nullable=True))
    op.create_index("ix_projects_trashed_at", "projects", ["trashed_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_projects_trashed_at", table_name="projects")
    op.drop_column("projects", "trashed_at")
    op.drop_column("projects", "is_archived")
