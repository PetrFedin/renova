"""iCalendar import result ledger (#422)

Backs atomic, response-loss-safe .ics import: one row per applied import
attempt, referenced as the `entity_id` for the `calendar.import` scope in
`client_write_requests` so a replayed request returns the original
parsed/updated_stages result instead of re-mapping events.

Revision ID: w25calendarimport01
Revises: w24projectpurgecascade01
"""

from alembic import op
import sqlalchemy as sa


revision = "w25calendarimport01"
down_revision = "w24projectpurgecascade01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ical_import_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("parsed", sa.Integer(), nullable=False),
        sa.Column("updated_stages", sa.Integer(), nullable=False),
        sa.Column("mapping_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ical_import_results_project_id", "ical_import_results", ["project_id"])
    op.create_index("ix_ical_import_results_content_sha256", "ical_import_results", ["content_sha256"])


def downgrade() -> None:
    op.drop_index("ix_ical_import_results_content_sha256", table_name="ical_import_results")
    op.drop_index("ix_ical_import_results_project_id", table_name="ical_import_results")
    op.drop_table("ical_import_results")
