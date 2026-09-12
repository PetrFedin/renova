"""Replay-safe replacement for user-created chat threads."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import chat_service, chat_thread_intent as thread_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["chats"])


class ThreadCreateIntent(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=255)
    topic: str | None = None


@router.post("/{project_id}/chats")
async def create_chat_thread(
    project_id: str,
    body: ThreadCreateIntent,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        thread = await thread_svc.create_thread(
            db,
            project_id=project_id,
            user_id=user.id,
            client_request_id=body.client_request_id,
            title=body.title,
            topic=body.topic,
        )
    except IdempotencyConflict as error:
        raise HTTPException(409, "idempotency_conflict") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return chat_service.thread_dict(thread)
