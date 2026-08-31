"""Chat object ACL — thread bind plus narrow invited-participant capability."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_project
from app.models.entities import ChatMessage, ChatThread, Project, User
from app.services import chat_participant_service


async def require_chat_access(
    db: AsyncSession,
    project_id: str,
    thread_id: str,
    user: User,
    *,
    write: bool = False,
    allow_participant: bool = False,
) -> tuple[Project, ChatThread]:
    """Authorize project authority or an explicitly allowed active participant.

    ``allow_participant`` grants access only to this exact thread. Callers opt in
    for thread-local operations (read/send/read-receipt/personal state). Project,
    task and finance mutations keep the default and remain fail-closed.

    Messages are eagerly loaded at the ACL boundary because downstream async API
    read paths serialize ``thread.messages``. This prevents implicit relationship
    I/O from escaping SQLAlchemy's greenlet context and keeps authorization plus
    serialization deterministic for both SQLite E2E and PostgreSQL runtime.
    """
    thread = await db.get(ChatThread, thread_id, options=(selectinload(ChatThread.messages),))
    if not thread or thread.project_id != project_id:
        raise HTTPException(404, "chat_not_found")

    try:
        project = await require_project(db, project_id, user, write=write)
        return project, thread
    except HTTPException as exc:
        if exc.status_code != 403 or not allow_participant:
            raise

    project = await db.get(Project, project_id)
    if not project or getattr(project, "trashed_at", None):
        raise HTTPException(404, "chat_not_found")
    if not await chat_participant_service.is_active_thread_participant(
        db,
        thread_id=thread_id,
        user_id=user.id,
    ):
        raise HTTPException(403, "Нет доступа")
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
