from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import issue_service as issue_svc
from app.services import technical_supervision_action_service as actions

router = APIRouter(
    prefix="/projects/{project_id}/technical-supervision",
    tags=["technical-supervision"],
)


class TechnicalQualityIssueIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    room_id: str | None = None
    stage_id: str | None = None
    severity: str = "medium"
    floor_plan_id: str | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    photo_key: str | None = Field(default=None, max_length=512)


@router.post("/issues")
async def create_technical_quality_issue(
    project_id: str,
    body: TechnicalQualityIssueIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    issue = await actions.create_quality_issue(
        db,
        project=project,
        actor=user,
        title=body.title,
        description=body.description,
        room_id=body.room_id,
        stage_id=body.stage_id,
        severity=body.severity,
        floor_plan_id=body.floor_plan_id,
        x_pct=body.x_pct,
        y_pct=body.y_pct,
        photo_key=body.photo_key,
    )
    return issue_svc.issue_dict(issue)
