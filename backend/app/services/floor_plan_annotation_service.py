"""Markup on a floor plan: validation, measurement and soft removal.

Geometry arrives as percentages of the sheet, so it is checked here rather
than trusted: a stroke that escapes the sheet is not a rendering quirk, it is a
remark nobody will ever see.

Measurement resolves against the sheet's calibration at write time and is
stored. A later recalibration therefore cannot rewrite a length someone has
already acted on — the two values simply disagree, visibly, instead of the
record changing under them.
"""

from __future__ import annotations

import json
import math
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import FloorPlan
from app.models.floor_plan_annotation import (
    POINT_KINDS,
    SEGMENT_KINDS,
    AnnotationKind,
    FloorPlanAnnotation,
    metres_for,
)

#: A freehand stroke is sampled by the device; beyond this it is noise and a
#: payload large enough to matter. The editor simplifies before sending.
MAX_POINTS = 2000

#: Notes are read on a phone. Longer than this belongs in the chat.
MAX_TEXT = 2000


class AnnotationError(ValueError):
    """A refusal the client should show, with a stable code."""


def parse_kind(value: str) -> AnnotationKind:
    try:
        return AnnotationKind(value)
    except ValueError as error:
        raise AnnotationError("annotation_kind_unknown") from error


def normalize_geometry(kind: AnnotationKind, points: Iterable[Any]) -> list[dict[str, float]]:
    """Validate the shape of the geometry and clamp it to the sheet."""
    cleaned: list[dict[str, float]] = []
    for point in points or []:
        if not isinstance(point, dict):
            raise AnnotationError("annotation_geometry_invalid")
        try:
            x = float(point["x"])
            y = float(point["y"])
        except (KeyError, TypeError, ValueError) as error:
            raise AnnotationError("annotation_geometry_invalid") from error
        if not (math.isfinite(x) and math.isfinite(y)):
            raise AnnotationError("annotation_geometry_invalid")
        # Clamped rather than refused: a finger sliding off the edge of the
        # sheet is an ordinary gesture, not a malformed request.
        cleaned.append({"x": min(100.0, max(0.0, x)), "y": min(100.0, max(0.0, y))})

    if not cleaned:
        raise AnnotationError("annotation_geometry_empty")
    if len(cleaned) > MAX_POINTS:
        raise AnnotationError("annotation_geometry_too_long")

    if kind in POINT_KINDS and len(cleaned) != 1:
        raise AnnotationError("annotation_geometry_expects_point")
    if kind in SEGMENT_KINDS and len(cleaned) != 2:
        raise AnnotationError("annotation_geometry_expects_segment")
    if kind in {AnnotationKind.rect, AnnotationKind.ellipse} and len(cleaned) != 2:
        raise AnnotationError("annotation_geometry_expects_corners")

    return cleaned


def segment_length_pct(points: list[dict[str, float]], plan: FloorPlan | None = None) -> float:
    """Length of a two-point segment as a share of the sheet's diagonal.

    `x` is a percentage of the sheet's width and `y` of its height, so they are
    not the same physical unit and cannot be combined directly. The first
    version of this function did exactly that, and on a 4:3 sheet reported a
    horizontal and a vertical "10%" as equal when they differ by a third.

    With the sheet's pixel dimensions known, both axes are converted to pixels
    first and the result expressed against the real diagonal. Without them the
    aspect ratio is unknown, and the square assumption is the only one
    available — so the value is still self-consistent, and calibration, which
    goes through this same function, cancels the factor out.
    """
    if len(points) < 2:
        return 0.0
    dx = points[1]["x"] - points[0]["x"]
    dy = points[1]["y"] - points[0]["y"]

    width = float(getattr(plan, "width_px", 0) or 0) if plan is not None else 0.0
    height = float(getattr(plan, "height_px", 0) or 0) if plan is not None else 0.0
    if width > 0 and height > 0:
        length_px = math.hypot(dx / 100.0 * width, dy / 100.0 * height)
        diagonal_px = math.hypot(width, height)
        return length_px / diagonal_px * 100.0

    return math.hypot(dx, dy)


def resolve_measurement(
    plan: FloorPlan, kind: AnnotationKind, points: list[dict[str, float]]
) -> float | None:
    if kind is not AnnotationKind.measure:
        return None
    return metres_for(plan, segment_length_pct(points, plan))


def clean_text(value: str | None, *, kind: AnnotationKind) -> str | None:
    text = (value or "").strip()
    if not text:
        if kind in {AnnotationKind.note, AnnotationKind.text}:
            raise AnnotationError("annotation_text_required")
        return None
    if len(text) > MAX_TEXT:
        raise AnnotationError("annotation_text_too_long")
    return text


async def get_plan(db: AsyncSession, *, project_id: str, plan_id: str) -> FloorPlan | None:
    """Scoped lookup: a sheet from another project is simply not found."""
    return (
        await db.execute(
            select(FloorPlan).where(
                FloorPlan.id == plan_id,
                FloorPlan.project_id == project_id,
            )
        )
    ).scalars().first()


async def list_annotations(
    db: AsyncSession,
    *,
    project_id: str,
    plan_id: str,
    include_deleted: bool = False,
) -> list[FloorPlanAnnotation]:
    query = select(FloorPlanAnnotation).where(
        FloorPlanAnnotation.project_id == project_id,
        FloorPlanAnnotation.floor_plan_id == plan_id,
    )
    if not include_deleted:
        query = query.where(FloorPlanAnnotation.deleted_at.is_(None))
    result = await db.execute(query.order_by(FloorPlanAnnotation.created_at.asc()))
    return list(result.scalars().all())


async def get_annotation(
    db: AsyncSession, *, project_id: str, annotation_id: str
) -> FloorPlanAnnotation | None:
    return (
        await db.execute(
            select(FloorPlanAnnotation).where(
                FloorPlanAnnotation.id == annotation_id,
                FloorPlanAnnotation.project_id == project_id,
            )
        )
    ).scalars().first()


def build(
    *,
    project_id: str,
    plan: FloorPlan,
    author_id: str,
    kind_value: str,
    points: Iterable[Any],
    color: str | None,
    stroke_width: float | None,
    text: str | None,
) -> FloorPlanAnnotation:
    kind = parse_kind(kind_value)
    geometry = normalize_geometry(kind, points)
    width = float(stroke_width if stroke_width is not None else 2)
    if not math.isfinite(width) or width <= 0:
        raise AnnotationError("annotation_stroke_invalid")

    return FloorPlanAnnotation(
        project_id=project_id,
        floor_plan_id=plan.id,
        author_id=author_id,
        kind=kind.value,
        geometry_json=json.dumps(geometry, ensure_ascii=False),
        color=(color or "#EF4444")[:16],
        stroke_width=width,
        text=clean_text(text, kind=kind),
        measured_m=resolve_measurement(plan, kind, geometry),
    )


def soft_delete(annotation: FloorPlanAnnotation, *, by_user_id: str) -> bool:
    """Returns False when it was already removed, so a replay stays honest."""
    if annotation.deleted_at is not None:
        return False
    annotation.deleted_at = utc_now()
    annotation.deleted_by = by_user_id
    return True


def to_dict(annotation: FloorPlanAnnotation) -> dict[str, Any]:
    try:
        geometry = json.loads(annotation.geometry_json)
    except (TypeError, ValueError):
        geometry = []
    return {
        "id": annotation.id,
        "floor_plan_id": annotation.floor_plan_id,
        "author_id": annotation.author_id,
        "kind": annotation.kind,
        "points": geometry,
        "color": annotation.color,
        "stroke_width": annotation.stroke_width,
        "text": annotation.text,
        "measured_m": annotation.measured_m,
        "created_at": annotation.created_at.isoformat() if annotation.created_at else None,
        "updated_at": annotation.updated_at.isoformat() if annotation.updated_at else None,
        "deleted_at": annotation.deleted_at.isoformat() if annotation.deleted_at else None,
        "deleted_by": annotation.deleted_by,
    }
