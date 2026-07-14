"""purchases, suppliers, purchase_items

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1

Note: material_picks historically создавался через create_all (SQLite).
На чистом Postgres создаём таблицу here before FK.
"""
from alembic import op
import sqlalchemy as sa

revision = "g7h8i9j0k1l2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def upgrade():
    if not _has_table("material_picks"):
        op.create_table(
            "material_picks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
            sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("qty", sa.Float(), server_default="1"),
            sa.Column("unit", sa.String(16), server_default="шт"),
            sa.Column("price", sa.Float(), server_default="0"),
            sa.Column("shop_url", sa.String(512), nullable=True),
            sa.Column("shop_name", sa.String(64), nullable=True),
            sa.Column("work_type", sa.String(64), nullable=True),
            sa.Column("category", sa.String(32), nullable=True),
            sa.Column("stage_id", sa.String(36), nullable=True),
            sa.Column("qty_needed", sa.Float(), nullable=True),
            sa.Column("qty_delivered", sa.Float(), server_default="0"),
            sa.Column("status", sa.String(32), server_default="draft"),
            sa.Column("analog_of_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("site", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "purchases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("supplier_id", sa.String(36), sa.ForeignKey("suppliers.id"), nullable=True),
        sa.Column("supplier_name", sa.String(128), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("total_amount", sa.Float(), server_default="0"),
        sa.Column("ordered_at", sa.DateTime(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("receipt_id", sa.String(36), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "purchase_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("purchase_id", sa.String(36), sa.ForeignKey("purchases.id"), nullable=False, index=True),
        sa.Column("material_pick_id", sa.String(36), sa.ForeignKey("material_picks.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("qty", sa.Float(), server_default="1"),
        sa.Column("unit", sa.String(16), server_default="шт"),
        sa.Column("unit_price", sa.Float(), server_default="0"),
        sa.Column("room_id", sa.String(36), nullable=True),
        sa.Column("stage_id", sa.String(36), nullable=True),
    )
    # Columns may already exist if material_picks was just created above with full schema
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("material_picks")}
    with op.batch_alter_table("material_picks") as batch:
        if "category" not in cols:
            batch.add_column(sa.Column("category", sa.String(32), nullable=True))
        if "qty_needed" not in cols:
            batch.add_column(sa.Column("qty_needed", sa.Float(), nullable=True))
        if "qty_delivered" not in cols:
            batch.add_column(sa.Column("qty_delivered", sa.Float(), server_default="0"))
        if "stage_id" not in cols:
            batch.add_column(sa.Column("stage_id", sa.String(36), nullable=True))


def downgrade():
    op.drop_table("purchase_items")
    op.drop_table("purchases")
    op.drop_table("suppliers")
