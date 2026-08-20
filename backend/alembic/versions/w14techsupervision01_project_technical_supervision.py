"""project technical supervision assignments

Revision ID: w14techsupervision01
Revises: w13ormparity01
Create Date: 2026-08-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w14techsupervision01"
down_revision: str | None = "w13ormparity01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_technical_supervisor_assignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("representative_user_id", sa.String(length=36), nullable=False),
        sa.Column("provider_type", sa.String(length=16), nullable=False),
        sa.Column("provider_name", sa.String(length=255), nullable=False),
        sa.Column("appointed_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("appointed_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("supersedes_assignment_id", sa.String(length=36), nullable=True),
        sa.CheckConstraint(
            "provider_type IN ('individual', 'company')",
            name="ck_project_technical_supervisor_provider_type",
        ),
        sa.ForeignKeyConstraint(["appointed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["representative_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["revoked_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["supersedes_assignment_id"],
            ["project_technical_supervisor_assignments.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_technical_supervisor_assignments_project_id",
        "project_technical_supervisor_assignments",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_project_technical_supervisor_assignments_representative_user_id",
        "project_technical_supervisor_assignments",
        ["representative_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_project_technical_supervisor_assignments_revoked_at",
        "project_technical_supervisor_assignments",
        ["revoked_at"],
        unique=False,
    )
    op.create_index(
        "ix_project_technical_supervisor_rep_active",
        "project_technical_supervisor_assignments",
        ["representative_user_id", "revoked_at"],
        unique=False,
    )
    op.create_index(
        "ux_project_technical_supervisor_active_project",
        "project_technical_supervisor_assignments",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ux_project_technical_supervisor_active_project",
        table_name="project_technical_supervisor_assignments",
    )
    op.drop_index(
        "ix_project_technical_supervisor_rep_active",
        table_name="project_technical_supervisor_assignments",
    )
    op.drop_index(
        "ix_project_technical_supervisor_assignments_revoked_at",
        table_name="project_technical_supervisor_assignments",
    )
    op.drop_index(
        "ix_project_technical_supervisor_assignments_representative_user_id",
        table_name="project_technical_supervisor_assignments",
    )
    op.drop_index(
        "ix_project_technical_supervisor_assignments_project_id",
        table_name="project_technical_supervisor_assignments",
    )
    op.drop_table("project_technical_supervisor_assignments")
