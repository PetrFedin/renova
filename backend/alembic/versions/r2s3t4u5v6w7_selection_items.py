"""selection_items P2.2

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
"""
from alembic import op
import sqlalchemy as sa

revision = "r2s3t4u5v6w7"
down_revision = "q1r2s3t4u5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "selection_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("room_id", sa.String(length=36), sa.ForeignKey("rooms.id"), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False, server_default="other"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=128), nullable=True),
        sa.Column("allowance", sa.Float(), nullable=True),
        sa.Column("price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("shop_url", sa.String(length=512), nullable=True),
        sa.Column("shop_name", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("proposed_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_selection_items_project_id", "selection_items", ["project_id"])
    op.create_index("ix_selection_items_room_id", "selection_items", ["room_id"])
    op.create_index("ix_selection_items_category", "selection_items", ["category"])


def downgrade() -> None:
    op.drop_index("ix_selection_items_category", table_name="selection_items")
    op.drop_index("ix_selection_items_room_id", table_name="selection_items")
    op.drop_index("ix_selection_items_project_id", table_name="selection_items")
    op.drop_table("selection_items")
