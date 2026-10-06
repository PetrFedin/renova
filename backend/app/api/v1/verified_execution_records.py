"""Read-only API for evidence-backed Renova Verified Execution Records."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import verified_execution_record_service as records


router = APIRouter(prefix="/projects", tags=["verified-execution-records"])


@router.get("/{project_id}/stages/{stage_id}/verified-execution-record")
async def verified_execution_record(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False, participant_ok=True, stage_id=stage_id)
    try:
        return await records.get_verified_execution_record(
            db,
            project_id=project_id,
            stage_id=stage_id,
        )
    except records.ExecutionRecordStageNotFound as exc:
        raise HTTPException(
            404,
            detail={"code": exc.code, "message": "Этап не найден в этом проекте"},
        ) from exc
    except records.ExecutionRecordNotAccepted as exc:
        raise HTTPException(
            409,
            detail={
                "code": exc.code,
                "message": "Verified Execution Record доступен только после канонической приёмки этапа",
            },
        ) from exc


@router.get("/{project_id}/stages/{stage_id}/verified-execution-record/portable-proof")
async def portable_execution_proof(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False, participant_ok=True, stage_id=stage_id)
    try:
        return await records.get_portable_execution_proof(
            db,
            project_id=project_id,
            stage_id=stage_id,
        )
    except records.ExecutionRecordStageNotFound as exc:
        raise HTTPException(
            404,
            detail={"code": exc.code, "message": "Этап не найден в этом проекте"},
        ) from exc
    except records.ExecutionRecordNotAccepted as exc:
        raise HTTPException(
            409,
            detail={"code": exc.code, "message": "Portable proof доступен только после канонической приёмки этапа"},
        ) from exc
