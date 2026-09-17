"""Drawing on a floor plan, and the scale that makes a ruler mean metres."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.models.floor_plan_annotation import metres_for
from app.services import floor_plan_annotation_service as annot_svc

router = APIRouter(prefix="/projects", tags=["floor-plan-annotations"])


class AnnotationIn(BaseModel):
    kind: str
    points: list[dict[str, Any]] = Field(min_length=1)
    color: str | None = None
    stroke_width: float | None = None
    text: str | None = None


class AnnotationPatch(BaseModel):
    color: str | None = None
    stroke_width: float | None = None
    text: str | None = None


class CalibrationIn(BaseModel):
    """A segment of known real length, drawn on the sheet.

    ``ref_pct`` is that segment's length as a share of the sheet diagonal, the
    same unit every measurement uses, so calibration and measurement cannot
    drift apart.
    """

    ref_pct: float = Field(gt=0, le=200)
    ref_m: float = Field(gt=0, le=1000)


def _refuse(error: annot_svc.AnnotationError) -> HTTPException:
    return HTTPException(422, detail={"code": str(error)})


async def _plan_or_404(db: AsyncSession, project_id: str, plan_id: str):
    plan = await annot_svc.get_plan(db, project_id=project_id, plan_id=plan_id)
    if not plan:
        # 404 for both "missing" and "another project's", so the API does not
        # disclose that a sheet exists elsewhere.
        raise HTTPException(404, "floor_plan_not_found")
    return plan


@router.get("/{project_id}/floor-plans/{plan_id}/annotations")
async def list_annotations(
    project_id: str,
    plan_id: str,
    include_deleted: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    plan = await _plan_or_404(db, project_id, plan_id)
    rows = await annot_svc.list_annotations(
        db, project_id=project_id, plan_id=plan.id, include_deleted=include_deleted
    )
    return {
        "floor_plan_id": plan.id,
        "scale_ref_pct": getattr(plan, "scale_ref_pct", None),
        "scale_ref_m": getattr(plan, "scale_ref_m", None),
        "items": [annot_svc.to_dict(row) for row in rows],
    }


@router.post("/{project_id}/floor-plans/{plan_id}/annotations")
async def create_annotation(
    project_id: str,
    plan_id: str,
    body: AnnotationIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    plan = await _plan_or_404(db, project_id, plan_id)

    try:
        annotation = annot_svc.build(
            project_id=project_id,
            plan=plan,
            author_id=user.id,
            kind_value=body.kind,
            points=body.points,
            color=body.color,
            stroke_width=body.stroke_width,
            text=body.text,
        )
    except annot_svc.AnnotationError as error:
        raise _refuse(error) from error

    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    return annot_svc.to_dict(annotation)


@router.patch("/{project_id}/floor-plans/{plan_id}/annotations/{annotation_id}")
async def update_annotation(
    project_id: str,
    plan_id: str,
    annotation_id: str,
    body: AnnotationPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    await _plan_or_404(db, project_id, plan_id)

    annotation = await annot_svc.get_annotation(
        db, project_id=project_id, annotation_id=annotation_id
    )
    if not annotation or annotation.floor_plan_id != plan_id:
        raise HTTPException(404, "annotation_not_found")
    if annotation.deleted_at is not None:
        raise HTTPException(409, "annotation_deleted")
    # Someone else's remark is theirs. Removing it is a separate, recorded act;
    # editing it in place would rewrite what they said.
    if annotation.author_id != user.id:
        raise HTTPException(403, "annotation_author_only")

    fields = body.model_dump(exclude_unset=True)
    if "color" in fields and fields["color"]:
        annotation.color = str(fields["color"])[:16]
    if "stroke_width" in fields and fields["stroke_width"] is not None:
        width = float(fields["stroke_width"])
        if width <= 0:
            raise _refuse(annot_svc.AnnotationError("annotation_stroke_invalid"))
        annotation.stroke_width = width
    if "text" in fields:
        try:
            annotation.text = annot_svc.clean_text(
                fields["text"], kind=annot_svc.parse_kind(annotation.kind)
            )
        except annot_svc.AnnotationError as error:
            raise _refuse(error) from error

    await db.commit()
    await db.refresh(annotation)
    return annot_svc.to_dict(annotation)


@router.delete("/{project_id}/floor-plans/{plan_id}/annotations/{annotation_id}")
async def delete_annotation(
    project_id: str,
    plan_id: str,
    annotation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The eraser. Soft, so a shared sheet keeps its history."""
    await require_project(db, project_id, user, write=True)
    await _plan_or_404(db, project_id, plan_id)

    annotation = await annot_svc.get_annotation(
        db, project_id=project_id, annotation_id=annotation_id
    )
    if not annotation or annotation.floor_plan_id != plan_id:
        raise HTTPException(404, "annotation_not_found")

    removed = annot_svc.soft_delete(annotation)
    await db.commit()
    return {"ok": True, "removed": removed, "replayed": not removed}


@router.post("/{project_id}/floor-plans/{plan_id}/calibrate")
async def calibrate_plan(
    project_id: str,
    plan_id: str,
    body: CalibrationIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set the sheet's scale from one segment of known length.

    Existing measurements keep the metres they were stored with. Recalibrating
    a sheet does not retroactively change a number someone has already read and
    acted on; the response reports what the same segments would measure now, so
    the disagreement is visible rather than silent.
    """
    await require_project(db, project_id, user, write=True)
    plan = await _plan_or_404(db, project_id, plan_id)

    plan.scale_ref_pct = float(body.ref_pct)
    plan.scale_ref_m = float(body.ref_m)
    await db.commit()
    await db.refresh(plan)

    rows = await annot_svc.list_annotations(db, project_id=project_id, plan_id=plan.id)
    restated = []
    for row in rows:
        if row.kind != "measure":
            continue
        import json as _json

        try:
            points = _json.loads(row.geometry_json)
        except (TypeError, ValueError):
            continue
        now_m = metres_for(plan, annot_svc.segment_length_pct(points))
        if now_m is not None and row.measured_m is not None and abs(now_m - row.measured_m) > 0.005:
            restated.append({"id": row.id, "stored_m": row.measured_m, "now_m": now_m})

    return {
        "floor_plan_id": plan.id,
        "scale_ref_pct": plan.scale_ref_pct,
        "scale_ref_m": plan.scale_ref_m,
        "restated": restated,
    }
