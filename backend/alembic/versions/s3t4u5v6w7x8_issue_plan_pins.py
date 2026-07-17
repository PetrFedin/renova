"""P2.3: plan-pinned punch list

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
"""
from alembic import op
import sqlalchemy as sa

revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_issues", sa.Column("floor_plan_id", sa.String(length=36), sa.ForeignKey("floor_plans.id"), nullable=True))
    op.add_column("project_issues", sa.Column("x_pct", sa.Float(), nullable=True))
    op.add_column("project_issues", sa.Column("y_pct", sa.Float(), nullable=True))
    op.add_column("project_issues", sa.Column("photo_key", sa.String(length=512), nullable=True))
    op.create_index("ix_project_issues_floor_plan_id", "project_issues", ["floor_plan_id"])


def downgrade() -> None:
    op.drop_index("ix_project_issues_floor_plan_id", table_name="project_issues")
    op.drop_column("project_issues", "photo_key")
    op.drop_column("project_issues", "y_pct")
    op.drop_column("project_issues", "x_pct")
    op.drop_column("project_issues", "floor_plan_id")
