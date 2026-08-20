from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project_work_schedule import WorkScheduleOut, WorkScheduleRejectIn
from app.services.project_work_schedule_service import get_schedule
from app.services.technical_supervision_action_service import reject_schedule_as_reviewer

router = APIRouter(
    prefix="/projects/{project_id}/work-schedules",
    tags=["work-schedules"],
)


@router.post("/{schedule_id}/reject", response_model=WorkScheduleOut)
async def reject_project_work_schedule(
    project_id: str,
    schedule_id: str,
    body: WorkScheduleRejectIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await require_project(db, project_id, user, write=False)
    schedule = await get_schedule(
        db,
        project_id=project.id,
        schedule_id=schedule_id,
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="work_schedule_not_found")
    return await reject_schedule_as_reviewer(
        db,
        project=project,
        schedule=schedule,
        actor=user,
        reason=body.reason,
    )
