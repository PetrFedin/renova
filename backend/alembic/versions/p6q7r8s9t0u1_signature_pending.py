"""document_signatures.signed_at nullable for pending e-sign

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
"""
from alembic import op
import sqlalchemy as sa

revision = "p6q7r8s9t0u1"
down_revision = "o5p6q7r8s9t0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("document_signatures") as batch:
        batch.alter_column("signed_at", existing_type=sa.DateTime(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("document_signatures") as batch:
        batch.alter_column("signed_at", existing_type=sa.DateTime(), nullable=False)
