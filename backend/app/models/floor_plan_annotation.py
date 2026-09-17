"""Markup drawn on a floor plan, stored as objects rather than as pixels.

The alternative — flattening every stroke into the plan image — loses the one
thing markup on a construction drawing is for: knowing who wrote what, when,
and being able to take it back. A vector object can be attributed, undone,
filtered by author, replayed on a re-uploaded sheet, and exported to a flat
copy when someone needs to send one. A burned-in pixel can do none of that.

Geometry is normalized to the plan, not to the screen: every coordinate is a
percentage of the sheet's width and height. The same annotation then renders
identically on a phone, on a tablet and in an exported PDF, and survives the
plan image being replaced by a higher-resolution scan.

Measurement is the reason the plan carries a calibration. A ruler drawn on an
uncalibrated sheet can report a length as a share of the sheet and nothing
more; once someone marks a segment of known length — a door, a wall on the
drawing's own dimension line — every other measurement follows from it.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, add_mapped_attribute, mapped_column

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import FloorPlan


def _uuid() -> str:
    return str(uuid.uuid4())


class AnnotationKind(str, enum.Enum):
    """What the author drew.

    Each value is a tool in the editor, and each is stored distinctly because
    they mean different things to a reader: a measurement is a claim about the
    building, a highlight is emphasis, a note is a sentence.
    """

    freehand = "freehand"      # карандаш
    marker = "marker"          # фломастер — wide, translucent
    line = "line"
    arrow = "arrow"
    rect = "rect"
    ellipse = "ellipse"
    measure = "measure"        # линейка / метраж
    note = "note"              # текстовая заметка в точке
    text = "text"


#: Kinds whose geometry is exactly two points.
SEGMENT_KINDS = frozenset({AnnotationKind.line, AnnotationKind.arrow, AnnotationKind.measure})

#: Kinds whose geometry is a single point.
POINT_KINDS = frozenset({AnnotationKind.note, AnnotationKind.text})


class FloorPlanAnnotation(Base):
    """One drawn object on one sheet.

    Deletion is soft. An eraser in a shared drawing is not a destructive
    operation — the other party may have been reading the sheet at the time,
    and "who removed the remark about the pipe" is exactly the question that
    gets asked later.
    """

    __tablename__ = "floor_plan_annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id"), index=True
    )
    floor_plan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("floor_plans.id"), index=True
    )
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)

    kind: Mapped[str] = mapped_column(String(16))

    #: Points as a JSON array of {"x": <pct>, "y": <pct>}, 0..100 of the sheet.
    geometry_json: Mapped[str] = mapped_column(Text)

    color: Mapped[str] = mapped_column(String(16), default="#EF4444")
    stroke_width: Mapped[float] = mapped_column(Float, default=2)
    #: Note, label on a measurement, or free text.
    text: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Metres, resolved at write time from the sheet's calibration. Stored so a
    #: later recalibration cannot silently rewrite what a reader already acted
    #: on; the editor shows both when they disagree.
    measured_m: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('freehand','marker','line','arrow','rect','ellipse','measure','note','text')",
            name="ck_floor_plan_annotations_kind",
        ),
        CheckConstraint("stroke_width > 0", name="ck_floor_plan_annotations_stroke"),
        CheckConstraint(
            "measured_m IS NULL OR measured_m >= 0",
            name="ck_floor_plan_annotations_measured",
        ),
        Index(
            "ix_floor_plan_annotations_sheet_live",
            "floor_plan_id",
            "deleted_at",
        ),
    )


# --- calibration, on the sheet it belongs to ---------------------------------
#
# Added to the existing FloorPlan rather than as a parallel entity: a sheet has
# one scale, and a second table would let a plan exist with two.

add_mapped_attribute(
    FloorPlan,
    "scale_ref_pct",
    mapped_column("scale_ref_pct", Float, nullable=True),
)
add_mapped_attribute(
    FloorPlan,
    "scale_ref_m",
    mapped_column("scale_ref_m", Float, nullable=True),
)


def is_calibrated(plan: FloorPlan) -> bool:
    ref_pct = getattr(plan, "scale_ref_pct", None)
    ref_m = getattr(plan, "scale_ref_m", None)
    return bool(ref_pct and ref_m and ref_pct > 0 and ref_m > 0)


def metres_for(plan: FloorPlan, length_pct: float) -> float | None:
    """Convert a length expressed as a share of the sheet into metres.

    Returns None for an uncalibrated sheet — the editor then shows the ruler
    without a number rather than inventing one.
    """
    if not is_calibrated(plan) or length_pct <= 0:
        return None
    return round(length_pct / float(plan.scale_ref_pct) * float(plan.scale_ref_m), 3)
