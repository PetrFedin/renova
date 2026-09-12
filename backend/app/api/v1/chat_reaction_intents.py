"""Replay-safe replacement for queued chat reaction mutation."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User
from app.services.chat_acl import require_chat_access, require_chat_message
from app.services import chat_reaction_intent as reaction_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["chats"])


class ReactionIntentBody(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80)
    emoji: str = Field(min_length=1, max_length=8)


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/react")
async def react_message(
    project_id: str,
    thread_id: str,
    message_id: str,
    body: ReactionIntentBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _project, thread = await require_chat_access(db, project_id, thread_id, user, write=True)
    await require_chat_message(db, thread, message_id)
    try:
        reactions = await reaction_svc.apply_reaction_intent(
            db,
            project_id=project_id,
            thread_id=thread_id,
            message_id=message_id,
            user_id=user.id,
            client_request_id=body.client_request_id,
            emoji=body.emoji,
        )
    except IdempotencyConflict as error:
        raise HTTPException(409, "idempotency_conflict") from error
    except ValueError as error:
        code = str(error)
        if code == "reaction_message_missing":
            raise HTTPException(404, code) from error
        raise HTTPException(400, code) from error
    return {"reactions": reactions}
