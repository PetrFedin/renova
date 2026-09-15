"""Atomic replay-safe ChatThread creation for offline/client retries."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import ChatThread, ChatThreadRead, User
from app.services import chat_service as chat_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(prefix="/projects", tags=["chats"])
CHAT_THREAD_CREATE_SCOPE = "chat.thread.create"


class ChatThreadCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    topic: str | None = Field(default=None, max_length=255)
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


def _idempotency_conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос чата уже использован с другими данными",
        },
    )


async def _canonical_thread(
    db: AsyncSession,
    *,
    project_id: str,
    thread_id: str,
) -> ChatThread:
    thread = await db.get(ChatThread, thread_id)
    if not thread or thread.project_id != project_id:
        raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    return thread


@router.post("/{project_id}/chats")
async def create_chat_thread_integrity(
    project_id: str,
    body: ChatThreadCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    payload = body.model_dump(exclude={"client_request_id"})

    try:
        replay_id = await replay_entity_id(
            db,
            scope=CHAT_THREAD_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if replay_id:
        thread = await _canonical_thread(db, project_id=project_id, thread_id=replay_id)
        result = chat_svc.thread_dict(thread)
        result["idempotent_replay"] = True
        return result

    thread = ChatThread(
        project_id=project_id,
        title=body.title.strip(),
        topic=body.topic.strip() if body.topic else None,
        created_by=user.id,
    )
    db.add(thread)
    await db.flush()
    db.add(ChatThreadRead(user_id=user.id, thread_id=thread.id))
    await db.flush()

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=CHAT_THREAD_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=thread.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if not created:
        thread = await _canonical_thread(db, project_id=project_id, thread_id=entity_id)
    else:
        await db.refresh(thread)

    result = chat_svc.thread_dict(thread)
    result["idempotent_replay"] = not created
    return result
