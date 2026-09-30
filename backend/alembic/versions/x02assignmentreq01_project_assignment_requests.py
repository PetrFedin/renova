"""Contractor self-claim requests awaiting customer confirmation

Revision ID: x02assignmentreq01
Revises: x01materialneeds01
"""

from alembic import op
import sqlalchemy as sa


revision = "x02assignmentreq01"
down_revision = "x01materialneeds01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_assignment_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("contractor_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.String(length=36), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','accepted','declined','superseded')",
            name="ck_project_assignment_requests_status",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contractor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_assignment_requests_project_id", "project_assignment_requests", ["project_id"]
    )
    op.create_index(
        "ix_project_assignment_requests_contractor_id", "project_assignment_requests", ["contractor_id"]
    )
    op.create_index(
        "ix_project_assignment_requests_status", "project_assignment_requests", ["status"]
    )
    op.create_index(
        "uq_project_assignment_requests_pending",
        "project_assignment_requests",
        ["project_id", "contractor_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_project_assignment_requests_pending", table_name="project_assignment_requests")
    op.drop_index("ix_project_assignment_requests_status", table_name="project_assignment_requests")
    op.drop_index("ix_project_assignment_requests_contractor_id", table_name="project_assignment_requests")
    op.drop_index("ix_project_assignment_requests_project_id", table_name="project_assignment_requests")
    op.drop_table("project_assignment_requests")
