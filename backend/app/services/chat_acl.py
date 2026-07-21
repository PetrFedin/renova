"""Chat object ACL — thread must belong to project; optional message bind."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project
from app.models.entities import ChatMessage, ChatThread, Project, User
from app.services import chat_service as chat_svc


async def require_chat_access(
    db: AsyncSession,
    project_id: str,
    thread_id: str,
    user: User,
    *,
    write: bool = False,
) -> tuple[Project, ChatThread]:
    """Project membership + thread.project_id bind. 404 on mismatch (no leak)."""
    project = await require_project(db, project_id, user, write=write)
    thread = await chat_svc.get_thread(db, thread_id)
    if not thread or thread.project_id != project.id:
        raise HTTPException(404, "chat_not_found")
    return project, thread


async def require_chat_message(
    db: AsyncSession,
    thread: ChatThread,
    message_id: str,
) -> ChatMessage:
    msg = await db.get(ChatMessage, message_id)
    if not msg or msg.thread_id != thread.id:
        raise HTTPException(404, "message_not_found")
    return msg
