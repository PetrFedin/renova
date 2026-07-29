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

    # Historical notes may contain duplicate CO markers. Link only the oldest
    # document for each order so the new one-to-one constraint remains valid.
    op.execute(
        sa.text(
            """
            WITH candidates AS (
                SELECT DISTINCT ON (change_order.id)
                    document.id AS document_id,
                    change_order.id AS change_order_id
                FROM project_documents AS document
                JOIN change_orders AS change_order
                  ON document.notes LIKE ('CO:' || change_order.id || ';%')
                WHERE document.change_order_id IS NULL
                ORDER BY change_order.id, document.created_at ASC, document.id ASC
            )
            UPDATE project_documents AS document
            SET change_order_id = candidates.change_order_id
            FROM candidates
            WHERE document.id = candidates.document_id
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
