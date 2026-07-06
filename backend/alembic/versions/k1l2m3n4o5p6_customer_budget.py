"""projects.customer_budget — лимит вложений заказчика

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
"""
from alembic import op
import sqlalchemy as sa

revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("customer_budget", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "customer_budget")
