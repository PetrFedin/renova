"""Frozen content snapshot of a signed contract version (DOC-009)

Revision ID: x03contractsnap01
Revises: x02assignmentreq01
"""

from alembic import op
import sqlalchemy as sa


revision = "x03contractsnap01"
down_revision = "x02assignmentreq01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_versions", sa.Column("content_snapshot", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("document_versions", "content_snapshot")
