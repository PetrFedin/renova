"""one approval document per change order

Revision ID: w7codoclink001
Revises: w6sidefxoutbox1
"""

from alembic import op
import sqlalchemy as sa


revision = "w7codoclink001"
down_revision = "w6sidefxoutbox1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_documents",
        sa.Column("change_order_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_project_documents_change_order_id",
        "project_documents",
        "change_orders",
        ["change_order_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_project_documents_change_order_id",
        "project_documents",
        ["change_order_id"],
        unique=True,
    )

    # Best-effort backfill from the historical notes marker CO:<uuid>.
    op.execute(
        sa.text(
            """
            UPDATE project_documents AS document
            SET change_order_id = change_order.id
            FROM change_orders AS change_order
            WHERE document.change_order_id IS NULL
              AND document.notes LIKE ('CO:' || change_order.id || ';%')
              AND NOT EXISTS (
                  SELECT 1
                  FROM project_documents AS existing
                  WHERE existing.change_order_id = change_order.id
              )
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_project_documents_change_order_id", table_name="project_documents")
    op.drop_constraint(
        "fk_project_documents_change_order_id",
        "project_documents",
        type_="foreignkey",
    )
    op.drop_column("project_documents", "change_order_id")
