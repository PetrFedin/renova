"""floor plan annotations and sheet calibration

Markup drawn on a plan is stored as objects, not burned into the image, so it
can be attributed, undone and re-rendered on a replacement scan. Calibration
lives on the sheet because a sheet has one scale.

Revision ID: w26planannotations01
Revises: w22projectparticipants01
Create Date: 2026-09-17
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w26planannotations01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_KIND_VALUES = (
    "freehand",
    "marker",
    "line",
    "arrow",
    "rect",
    "ellipse",
    "measure",
    "note",
    "text",
)


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if "floor_plan_annotations" not in inspector.get_table_names():
        op.create_table(
            "floor_plan_annotations",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("project_id", sa.String(length=36), nullable=False),
            sa.Column("floor_plan_id", sa.String(length=36), nullable=False),
            sa.Column("author_id", sa.String(length=36), nullable=False),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("geometry_json", sa.Text(), nullable=False),
            sa.Column("color", sa.String(length=16), nullable=False, server_default="#EF4444"),
            sa.Column("stroke_width", sa.Float(), nullable=False, server_default="2"),
            sa.Column("text", sa.Text(), nullable=True),
            sa.Column("measured_m", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["floor_plan_id"], ["floor_plans.id"]),
            sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
            sa.CheckConstraint(
                "kind IN (" + ", ".join(f"'{value}'" for value in _KIND_VALUES) + ")",
                name="ck_floor_plan_annotations_kind",
            ),
            sa.CheckConstraint("stroke_width > 0", name="ck_floor_plan_annotations_stroke"),
            sa.CheckConstraint(
                "measured_m IS NULL OR measured_m >= 0",
                name="ck_floor_plan_annotations_measured",
            ),
        )
        op.create_index(
            "ix_floor_plan_annotations_project_id",
            "floor_plan_annotations",
            ["project_id"],
        )
        op.create_index(
            "ix_floor_plan_annotations_author_id",
            "floor_plan_annotations",
            ["author_id"],
        )
        # The editor's only hot read: live markup for one sheet.
        op.create_index(
            "ix_floor_plan_annotations_sheet_live",
            "floor_plan_annotations",
            ["floor_plan_id", "deleted_at"],
        )

    # Calibration on the sheet. Nullable: an uncalibrated plan is a normal
    # state — the ruler simply reports no metres until someone sets the scale.
    if not _has_column("floor_plans", "scale_ref_pct"):
        op.add_column("floor_plans", sa.Column("scale_ref_pct", sa.Float(), nullable=True))
    if not _has_column("floor_plans", "scale_ref_m"):
        op.add_column("floor_plans", sa.Column("scale_ref_m", sa.Float(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if _has_column("floor_plans", "scale_ref_m"):
        op.drop_column("floor_plans", "scale_ref_m")
    if _has_column("floor_plans", "scale_ref_pct"):
        op.drop_column("floor_plans", "scale_ref_pct")

    if "floor_plan_annotations" in inspector.get_table_names():
        op.drop_index(
            "ix_floor_plan_annotations_sheet_live", table_name="floor_plan_annotations"
        )
        op.drop_index(
            "ix_floor_plan_annotations_author_id", table_name="floor_plan_annotations"
        )
        op.drop_index(
            "ix_floor_plan_annotations_project_id", table_name="floor_plan_annotations"
        )
        op.drop_table("floor_plan_annotations")
