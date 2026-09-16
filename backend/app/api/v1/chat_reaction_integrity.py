"""Replay-safe chat reaction state assignment.

A reaction mutation expresses the desired final state instead of toggling it.
This makes response-loss/offline replay deterministic: repeating reacted=true
cannot remove an already-applied reaction, and repeating reacted=false cannot add it.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.ws import broadcast
from app.db.session import get_db
from app.models.entities import ChatMessage, User
from app.services.chat_acl import require_chat_access, require_chat_message

router = APIRouter(prefix="/projects", tags=["chats"])


class ReactionStateBody(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)
    reacted: bool


def _parse_meta(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/react")
async def set_message_reaction_state(
    project_id: str,
    thread_id: str,
    message_id: str,
    body: ReactionStateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _project, thread = await require_chat_access(
        db,
        project_id,
        thread_id,
        user,
        write=False,
        allow_participant=True,
    )
    await require_chat_message(db, thread, message_id)

    # Serialize concurrent replays on production PostgreSQL so two identical
    # reacted=true commands cannot append the same user twice.
    message = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
            .with_for_update()
        )
    ).scalar_one()

    meta = _parse_meta(message.meta_json)
    reactions = meta.get("reactions")
    if not isinstance(reactions, dict):
        reactions = {}
        meta["reactions"] = reactions

    raw_users = reactions.get(body.emoji)
    users = [str(value) for value in raw_users] if isinstance(raw_users, list) else []
    # Heal historical duplicates while applying the state assignment.
    users = list(dict.fromkeys(users))
    present = user.id in users
    changed = False

    if body.reacted and not present:
        users.append(user.id)
        reactions[body.emoji] = users
        changed = True
    elif not body.reacted and present:
        users = [value for value in users if value != user.id]
        if users:
            reactions[body.emoji] = users
        else:
            reactions.pop(body.emoji, None)
        changed = True
    elif present and reactions.get(body.emoji) != users:
        reactions[body.emoji] = users
        changed = True

    if changed:
        message.meta_json = json.dumps(meta, ensure_ascii=False)
        await db.commit()
        await broadcast(
            thread_id,
            {
                "type": "reaction",
                "message_id": message_id,
                "reactions": reactions,
            },
        )

    return {
        "reactions": reactions,
        "reacted": body.reacted,
        "changed": changed,
    }
