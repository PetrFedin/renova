"""Replay-safe chat reaction intents.

The user action remains a toggle, but one user intent is executed at most once.
That preserves the existing add/remove UX while making response-loss replay safe.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage
from app.services import chat_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

logger = logging.getLogger(__name__)

REACTION_SCOPE = "chat.reaction"
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


def _validate_request_id(client_request_id: str) -> None:
    if not isinstance(client_request_id, str) or not _REQUEST_ID.fullmatch(client_request_id):
        raise ValueError("reaction_request_id_invalid")


def _payload(*, thread_id: str, message_id: str, emoji: str) -> dict:
    return {"thread_id": thread_id, "message_id": message_id, "emoji": emoji}


def _reactions(message: ChatMessage) -> dict[str, list[str]]:
    meta = chat_service._parse_meta(message.meta_json)
    value = meta.get("reactions")
    return value if isinstance(value, dict) else {}


async def apply_reaction_intent(
    db: AsyncSession,
    *,
    project_id: str,
    thread_id: str,
    message_id: str,
    user_id: str,
    client_request_id: str,
    emoji: str,
) -> dict[str, list[str]]:
    """Toggle exactly once for one stable client intent.

    The ChatMessage row lock serializes this with task-link metadata changes and
    with other reaction intents. The idempotency mapping is re-checked *after*
    acquiring that lock so a concurrent same-key waiter observes the first
    committed mapping and returns without toggling again.
    """
    _validate_request_id(client_request_id)
    payload = _payload(thread_id=thread_id, message_id=message_id, emoji=emoji)

    message = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if message is None:
        raise ValueError("reaction_message_missing")

    replay = await replay_entity_id(
        db,
        scope=REACTION_SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay:
        if replay != message_id:
            raise RuntimeError("reaction_replay_corrupt")
        current = _reactions(message)
        await db.commit()  # release row lock without another toggle
        return current

    meta = chat_service._parse_meta(message.meta_json)
    reactions: dict[str, list[str]] = meta.setdefault("reactions", {})
    users = reactions.setdefault(emoji, [])
    if user_id in users:
        users.remove(user_id)
        if not users:
            reactions.pop(emoji, None)
    else:
        users.append(user_id)
    message.meta_json = chat_service._dump_meta(meta)

    created, canonical_message_id = await commit_client_write(
        db,
        scope=REACTION_SCOPE,
        project_id=project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
        entity_id=message.id,
    )
    if not created:
        canonical = await db.get(ChatMessage, canonical_message_id)
        if canonical is None or canonical.thread_id != thread_id:
            raise RuntimeError("reaction_replay_corrupt")
        return _reactions(canonical)

    # The business write is committed. WebSocket delivery is acceleration only;
    # polling/reload is the durable fallback and a broadcast failure must not make
    # the client enqueue a second apparent business mutation.
    try:
        from app.api.v1.ws import broadcast

        await broadcast(
            thread_id,
            {"type": "reaction", "message_id": message_id, "reactions": reactions},
        )
    except Exception:
        logger.exception("reaction websocket acceleration failed after commit")
    return reactions
