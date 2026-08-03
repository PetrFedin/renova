"""Canonical stage submission and rejection endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import stage_review_service as reviews

router = APIRouter(prefix="/projects/{project_id}/stages", tags=["stages"])


class StageRejectIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _transition_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {"stage_submit_actor_forbidden", "stage_reject_actor_forbidden"}:
        return HTTPException(
            403,
            detail={"code": code, "message": "Это действие недоступно вашей роли или назначению"},
        )
    if code in {"stage_rejection_reason_required", "stage_rejection_reason_too_long"}:
        return HTTPException(
            422,
            detail={"code": code, "message": "Укажите причину возврата этапа на доработку"},
        )
    if code.startswith("stage_submit_invalid_status:"):
        return HTTPException(
            409,
            detail={"code": "stage_submit_invalid_status", "transition": code.split(":", 1)[1]},
        )
    if code.startswith("stage_reject_invalid_status:"):
        return HTTPException(
            409,
            detail={"code": "stage_reject_invalid_status", "transition": code.split(":", 1)[1]},
        )
    return HTTPException(409, detail={"code": code, "message": "Переход этапа недоступен"})


@router.post("/{stage_id}/submit")
async def submit_stage(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result, error = await reviews.submit_for_review(
            db,
            project=project,
            stage_id=stage_id,
            actor=user,
        )
    except ValueError as exc:
        raise _transition_error(exc) from exc
    if error:
        raise HTTPException(409, detail=error)
    if result is None:
        raise HTTPException(404, "Этап не найден")
    return {
        "ok": True,
        "status": result.stage.status.value,
        "contractor_ready": result.stage.contractor_ready,
        "acceptance_id": result.acceptance.id,
        "replayed": result.replayed,
    }


@router.post("/{stage_id}/reject")
async def reject_stage(
    project_id: str,
    stage_id: str,
    body: StageRejectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await reviews.reject_for_rework(
            db,
            project=project,
            stage_id=stage_id,
            actor=user,
            reason=body.text,
        )
    except ValueError as exc:
        raise _transition_error(exc) from exc
    if result is None:
        raise HTTPException(404, "Этап не найден")
    return {
        "ok": True,
        "status": result.stage.status.value,
        "needs_rework": result.stage.needs_rework,
        "rework_deadline": (
            result.stage.rework_deadline.isoformat()
            if result.stage.rework_deadline
            else None
        ),
        "acceptance_id": result.acceptance.id,
        "acceptance_status": result.acceptance.status,
        "replayed": result.replayed,
    }
