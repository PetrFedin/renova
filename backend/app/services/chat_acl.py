"""Chat object ACL — thread bind plus narrow invited-participant capability."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_project
from app.models.entities import ChatMessage, ChatMessageType, ChatThread, Project, User
from app.services import chat_participant_service


# COM-036: guests and read-only team viewers must not read money conversations.
MONEY_THREAD_TOPICS = frozenset({"payment", "payments", "finance", "budget", "invoice", "estimate"})
MONEY_THREAD_TOPIC_PREFIXES = ("payment:", "invoice:", "finance:", "budget:")
MONEY_MESSAGE_TYPES = (ChatMessageType.invoice, ChatMessageType.payment)


def _money_thread_condition():
    topic = ChatThread.topic
    return or_(
        topic.in_(MONEY_THREAD_TOPICS),
        *[topic.like(f"{prefix}%") for prefix in MONEY_THREAD_TOPIC_PREFIXES],
        ChatThread.id.in_(
            select(ChatMessage.thread_id).where(ChatMessage.message_type.in_(MONEY_MESSAGE_TYPES))
        ),
    )


async def money_thread_ids(db: AsyncSession, project_id: str) -> set[str]:
    """Threads of the project that carry money talk: money topic or invoice/payment messages."""
    rows = await db.execute(
        select(ChatThread.id).where(ChatThread.project_id == project_id, _money_thread_condition())
    )
    return set(rows.scalars().all())


async def thread_is_money(db: AsyncSession, thread: ChatThread) -> bool:
    return thread.id in await money_thread_ids(db, thread.project_id)


async def must_hide_money_threads(db: AsyncSession, project: Project, user: User) -> bool:
    """True for read-only guests and read-only contractor-team viewers (COM-036)."""
    from app.services import team_service as team_svc

    mode, read_only = await team_svc.project_access_mode(db, user, project)
    return bool(read_only) and mode in ("guest", "contractor")


async def require_chat_access(
    db: AsyncSession,
    project_id: str,
    thread_id: str,
    user: User,
    *,
    write: bool = False,
    allow_participant: bool = False,
    load_messages: bool = True,
) -> tuple[Project, ChatThread]:
    """Authorize project authority or an explicitly allowed active participant.

    ``allow_participant`` grants access only to this exact thread. Callers opt in
    for thread-local operations (read/send/read-receipt/personal state). Project,
    task and finance mutations keep the default and remain fail-closed.

    Messages are eagerly loaded at the ACL boundary because downstream async API
    read paths serialize ``thread.messages``. This prevents implicit relationship
    I/O from escaping SQLAlchemy's greenlet context and keeps authorization plus
    serialization deterministic for both SQLite E2E and PostgreSQL runtime.

    ``load_messages=False`` skips that eager load for paginated reads (COM-024):
    the caller must then query the page itself and never touch ``thread.messages``.
    """
    options = (selectinload(ChatThread.messages),) if load_messages else ()
    thread = await db.get(ChatThread, thread_id, options=options)
    if not thread or thread.project_id != project_id:
        raise HTTPException(404, "chat_not_found")

    try:
        project = await require_project(db, project_id, user, write=write)
        if await must_hide_money_threads(db, project, user) and await thread_is_money(db, thread):
            raise HTTPException(
                403,
                detail={
                    "code": "chat_money_thread_forbidden",
                    "message": "Переписка о деньгах недоступна гостям и наблюдателям.",
                },
            )
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
