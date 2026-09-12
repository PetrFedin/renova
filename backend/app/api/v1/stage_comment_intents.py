"""Canonical replay-safe writer for stage comments."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import stage_comment_intent as comment_svc
from app.services import stage_service as stage_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["stages"])


class StageCommentIntentIn(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    text: str = Field(min_length=1, max_length=2000)


@router.post("/{project_id}/stages/{stage_id}/comments")
async def add_comment(
    project_id: str,
    stage_id: str,
    body: StageCommentIntentIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    stage = await stage_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    try:
        comment = await comment_svc.create_comment(
            db,
            project_id=project_id,
            stage_id=stage_id,
            user_id=user.id,
            author_role=user.role.value,
            client_request_id=body.client_request_id,
            text=body.text,
        )
    except IdempotencyConflict as error:
        raise HTTPException(409, "idempotency_conflict") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {
        "id": comment.id,
        "text": comment.text,
        "author_role": comment.author_role,
        "created_at": comment.created_at.isoformat(),
    }
