"""Material-needs-from-estimate generation result ledger (#419)

Backs atomic, replay-safe estimate-to-material-needs generation: one row per
applied generation attempt, referenced as the `entity_id` for the
`material_needs.generate` scope in `client_write_requests` so a replayed
request returns the original generated MaterialPick set instead of
re-scanning the estimate and risking a concurrent duplicate insert.

Revision ID: x01materialneeds01
Revises: w25calendarimport01
"""

from alembic import op
import sqlalchemy as sa


revision = "x01materialneeds01"
down_revision = "w25calendarimport01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_needs_generation_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("created_pick_ids_json", sa.Text(), nullable=False),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_material_needs_generation_results_project_id",
        "material_needs_generation_results",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_material_needs_generation_results_project_id",
        table_name="material_needs_generation_results",
    )
    op.drop_table("material_needs_generation_results")
