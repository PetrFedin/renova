"""ACL for chat attachment media keys (#453).

Two key shapes are in play:

- Canonical (new writes): ``chat-media/{thread_id}/…`` — the thread id is
  encoded in the storage key itself, so no extra lookup is required to
  determine ownership.
- Legacy (pre-#453 writes): ``chat/{filename}`` — the thread is not encoded
  in the key. Ownership is resolved through the persisted
  ``ChatMessage.storage_key`` back-reference. A key that is unreferenced, or
  referenced by messages spanning more than one thread, fails closed (404):
  we never guess which thread "owns" an ambiguous key.

Either way, access is delegated to ``chat_acl.require_chat_access`` with
``allow_participant=True`` so this mirrors the canonical chat visibility
decision exactly instead of inventing a parallel permission model. Not-found
and not-authorized both surface as 404 (privacy — do not confirm to an
outsider that a given key exists).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage, ChatThread, User
from app.services.chat_acl import require_chat_access

# ChatThread.id — UUID or short id from seeds/tests, same shape as document ACL.
_THREAD_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    r"|^[0-9a-zA-Z_-]{1,64}$"
)


@dataclass(frozen=True)
class ChatMediaKey:
    thread_id: str
    relative_path: str


def parse_chat_media_key(storage_key: str) -> ChatMediaKey | None:
    """Extract thread_id from canonical chat-media/{thread_id}/…. Else None."""
    key = (storage_key or "").lstrip("/")
    if not key.startswith("chat-media/"):
        return None
    rest = key[len("chat-media/") :]
    if not rest or "/" not in rest:
        return None
    thread_id, relative = rest.split("/", 1)
    if not thread_id or not relative or ".." in relative.split("/"):
        return None
    if not _THREAD_ID_RE.match(thread_id):
        return None
    return ChatMediaKey(thread_id=thread_id, relative_path=relative)


def is_legacy_chat_media_key(storage_key: str) -> bool:
    """Pre-#453 keys: chat/{filename} — no thread encoded in the path."""
    key = (storage_key or "").lstrip("/")
    return key.startswith("chat/") and len(key) > len("chat/")


def is_chat_media_key(storage_key: str) -> bool:
    return parse_chat_media_key(storage_key) is not None or is_legacy_chat_media_key(storage_key)


async def _resolve_legacy_owning_thread(db: AsyncSession, storage_key: str) -> str | None:
    """Resolve the single owning thread for a legacy chat/* key.

    Fails closed (returns None) when the key is unreferenced by any message,
    or is referenced by messages belonging to more than one thread.
    """
    result = await db.execute(
        select(ChatMessage.thread_id).where(ChatMessage.storage_key == storage_key).distinct()
    )
    thread_ids = result.scalars().all()
    if len(thread_ids) != 1:
        return None
    return thread_ids[0]


async def assert_chat_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> str:
    """Verify current thread authority (project or thread-only participant).

    Returns the resolved thread_id on success. Raises 404 for anything that
    must not confirm the key's existence to an unauthorized caller: unknown
    key shape handled elsewhere by the caller, unreferenced/ambiguous legacy
    key, missing thread, or lack of chat authority (403 from the underlying
    ACL is remapped to 404 here — privacy, matching the document media ACL).
    """
    parsed = parse_chat_media_key(storage_key)
    if parsed is not None:
        thread_id = parsed.thread_id
    else:
        thread_id = await _resolve_legacy_owning_thread(db, storage_key)
        if thread_id is None:
            raise HTTPException(404, "chat_media_not_found")

    thread = await db.get(ChatThread, thread_id)
    if not thread:
        raise HTTPException(404, "chat_media_not_found")

    try:
        await require_chat_access(
            db,
            thread.project_id,
            thread_id,
            user,
            write=write,
            allow_participant=True,
        )
    except HTTPException as exc:
        if exc.status_code in (403, 404):
            raise HTTPException(404, "chat_media_not_found") from exc
        raise
    return thread_id
