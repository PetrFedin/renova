"""Chat attachment storage-key parsing and thread visibility enforcement."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage, ChatThread, User
from app.services import chat_acl
from app.services.storage_service import normalize_storage_key

CHAT_MEDIA_PREFIX = "chat-media"
LEGACY_CHAT_MEDIA_PREFIX = "chat/"


@dataclass(frozen=True)
class ChatMediaKey:
    thread_id: str
    relative_path: str


def parse_chat_media_key(storage_key: str) -> ChatMediaKey | None:
    try:
        key = normalize_storage_key(storage_key)
    except Exception:
        return None
    prefix = f"{CHAT_MEDIA_PREFIX}/"
    if not key.startswith(prefix):
        return None
    rest = key[len(prefix) :]
    if "/" not in rest:
        return None
    thread_id, relative = rest.split("/", 1)
    if not thread_id or not relative:
        return None
    return ChatMediaKey(thread_id=thread_id, relative_path=relative)


def is_legacy_chat_media_key(storage_key: str) -> bool:
    try:
        return normalize_storage_key(storage_key).startswith(LEGACY_CHAT_MEDIA_PREFIX)
    except Exception:
        return False


def _privacy_not_found() -> HTTPException:
    return HTTPException(404, "chat_media_not_found")


async def _authorize_thread(
    db: AsyncSession,
    *,
    user: User,
    thread_id: str,
) -> ChatThread:
    thread = await db.get(ChatThread, thread_id)
    if thread is None:
        raise _privacy_not_found()
    try:
        _project, authorized_thread = await chat_acl.require_chat_access(
            db,
            thread.project_id,
            thread.id,
            user,
            write=False,
            allow_participant=True,
        )
    except HTTPException as exc:
        # Media possession must not disclose whether a protected thread exists.
        if exc.status_code in {403, 404}:
            raise _privacy_not_found() from exc
        raise
    return authorized_thread


async def assert_chat_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
) -> ChatMediaKey:
    parsed = parse_chat_media_key(storage_key)
    if parsed is None:
        raise _privacy_not_found()
    await _authorize_thread(db, user=user, thread_id=parsed.thread_id)
    return parsed


async def _legacy_thread_ids(db: AsyncSession, storage_key: str) -> set[str]:
    key = normalize_storage_key(storage_key)
    rows = (
        await db.execute(
            select(ChatMessage.thread_id).where(ChatMessage.storage_key == key)
        )
    ).scalars().all()
    return {str(thread_id) for thread_id in rows if thread_id}


async def assert_legacy_chat_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
) -> str:
    """Resolve legacy ``chat/*`` bytes through persisted message ownership.

    More than one owning thread is ambiguous and therefore fails closed. Multiple
    messages in the same thread may legitimately point at one retained blob.
    """
    if not is_legacy_chat_media_key(storage_key):
        raise _privacy_not_found()
    thread_ids = await _legacy_thread_ids(db, storage_key)
    if len(thread_ids) != 1:
        raise _privacy_not_found()
    thread_id = next(iter(thread_ids))
    await _authorize_thread(db, user=user, thread_id=thread_id)
    return thread_id
