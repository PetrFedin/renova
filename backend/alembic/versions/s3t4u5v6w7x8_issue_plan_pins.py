"""P2.3: plan-pinned punch list

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7

Note: project_issues / floor_plans historically from create_all (SQLite).
On clean Postgres create tables here; on existing DB add punch columns.
"""
from alembic import op
import sqlalchemy as sa

revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _cols(name: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(name)}


def _ensure_floor_plans() -> None:
    if _has_table("floor_plans"):
        return
    op.create_table(
        "floor_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("name", sa.String(128), nullable=False, server_default="Планировка"),
        sa.Column("image_key", sa.String(512), nullable=False),
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("floor_level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def _ensure_floor_plan_pins() -> None:
    if _has_table("floor_plan_pins"):
        return
    op.create_table(
        "floor_plan_pins",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("floor_plan_id", sa.String(36), sa.ForeignKey("floor_plans.id"), nullable=False, index=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=False, index=True),
        sa.Column("x_pct", sa.Float(), nullable=False, server_default="50"),
        sa.Column("y_pct", sa.Float(), nullable=False, server_default="50"),
        sa.Column("label", sa.String(64), nullable=True),
    )


def _ensure_project_issues() -> None:
    if not _has_table("project_issues"):
        op.create_table(
            "project_issues",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
            sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True),
            sa.Column("stage_id", sa.String(36), sa.ForeignKey("stages.id"), nullable=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(16), nullable=False, server_default="open", index=True),
            sa.Column("assignee_id", sa.String(36), nullable=True),
            sa.Column("due_at", sa.DateTime(), nullable=True),
            sa.Column("floor_plan_id", sa.String(36), sa.ForeignKey("floor_plans.id"), nullable=True, index=True),
            sa.Column("x_pct", sa.Float(), nullable=True),
            sa.Column("y_pct", sa.Float(), nullable=True),
            sa.Column("photo_key", sa.String(512), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
        )
        return

    cols = _cols("project_issues")
    if "floor_plan_id" not in cols:
        op.add_column("project_issues", sa.Column("floor_plan_id", sa.String(36), sa.ForeignKey("floor_plans.id"), nullable=True))
        op.create_index("ix_project_issues_floor_plan_id", "project_issues", ["floor_plan_id"])
    if "x_pct" not in cols:
        op.add_column("project_issues", sa.Column("x_pct", sa.Float(), nullable=True))
    if "y_pct" not in cols:
        op.add_column("project_issues", sa.Column("y_pct", sa.Float(), nullable=True))
    if "photo_key" not in cols:
        op.add_column("project_issues", sa.Column("photo_key", sa.String(512), nullable=True))


def upgrade() -> None:
    _ensure_floor_plans()
    _ensure_floor_plan_pins()
    _ensure_project_issues()


def downgrade() -> None:
    if not _has_table("project_issues"):
        return
    cols = _cols("project_issues")
    if "floor_plan_id" in cols:
        op.drop_index("ix_project_issues_floor_plan_id", table_name="project_issues")
        op.drop_column("project_issues", "floor_plan_id")
    if "photo_key" in cols:
        op.drop_column("project_issues", "photo_key")
    if "y_pct" in cols:
        op.drop_column("project_issues", "y_pct")
    if "x_pct" in cols:
        op.drop_column("project_issues", "x_pct")
