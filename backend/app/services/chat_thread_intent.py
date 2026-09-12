"""Replay-safe user chat-thread creation for #390 / parent #316."""
from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage, ChatMessageType, ChatThread
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "chat.thread.create"
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


def _normalize_title(value: str) -> str:
    title = " ".join((value or "").strip().split())
    if not title or len(title) > 255:
        raise ValueError("chat_thread_title_invalid")
    return title


def _validate_request_id(value: str) -> None:
    if not isinstance(value, str) or not _REQUEST_ID.fullmatch(value):
        raise ValueError("chat_thread_request_id_invalid")


async def _replay_thread(db: AsyncSession, *, project_id: str, thread_id: str) -> ChatThread:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.project_id != project_id:
        raise RuntimeError("chat_thread_replay_corrupt")
    return thread


async def create_thread(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    title: str,
    topic: str | None,
) -> ChatThread:
    """Create one thread per user intent, never per title equality.

    The candidate ChatThread, its initial system message and ClientWriteRequest
    mapping are one transaction. Concurrent same-key candidates are fenced by
    the unique client-write mapping; the loser rolls back its entire graph and
    resolves the winner's canonical thread id.
    """
    _validate_request_id(client_request_id)
    clean_title = _normalize_title(title)
    payload = {"title": clean_title, "topic": topic}

    replay = await replay_entity_id(
        db,
        scope=SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay:
        return await _replay_thread(db, project_id=project_id, thread_id=replay)

    try:
        thread = ChatThread(
            project_id=project_id,
            title=clean_title,
            topic=topic,
            created_by=user_id,
        )
        db.add(thread)
        await db.flush()
        db.add(
            ChatMessage(
                thread_id=thread.id,
                user_id=user_id,
                author_role="system",
                message_type=ChatMessageType.system,
                text=f"Чат «{clean_title}» создан",
            )
        )
        created, entity_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=thread.id,
        )
        if not created:
            return await _replay_thread(db, project_id=project_id, thread_id=entity_id)
        await db.refresh(thread)
        return thread
    except BaseException:
        await db.rollback()
        raise
