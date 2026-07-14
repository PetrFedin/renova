"""document legal_hold + retention_until

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
"""
from alembic import op
import sqlalchemy as sa

revision = "n4o5p6q7r8s9"
down_revision = "m3n4o5p6q7r8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_documents",
        sa.Column("legal_hold", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "project_documents",
        sa.Column("retention_until", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_documents", "retention_until")
    op.drop_column("project_documents", "legal_hold")
