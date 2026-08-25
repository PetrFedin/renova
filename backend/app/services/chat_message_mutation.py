"""Atomic, idempotent client-originated chat message mutation."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    ChatThreadRead,
    Project,
    User,
)
from app.services import outbox_inline_dispatch
from app.services import outbox_service as outbox
from app.services import storage_service as storage_svc
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

logger = logging.getLogger(__name__)

MESSAGE_CREATE_SCOPE = "chat.message.create"


def _payload_identity(
    *,
    thread_id: str,
    text: str | None,
    message_type: str,
    image_data: str | None,
    reply_to_id: str | None,
    meta: dict[str, Any] | None,
) -> dict[str, Any]:
    """Canonical request identity without persisting raw attachment bytes."""
    return {
        "thread_id": thread_id,
        "text": text,
        "message_type": message_type,
        "image_sha256": (
            hashlib.sha256(image_data.encode("utf-8")).hexdigest()
            if image_data is not None
            else None
        ),
        "reply_to_id": reply_to_id,
        "meta": meta or {},
    }


async def _load_replay_message(
    db: AsyncSession,
    *,
    thread_id: str,
    entity_id: str,
) -> ChatMessage:
    message = await db.get(ChatMessage, entity_id)
    if message is None or message.thread_id != thread_id:
        raise RuntimeError("chat_message_idempotency_ledger_corrupt")
    return message


async def _validate_reply_target(
    db: AsyncSession,
    *,
    thread_id: str,
    reply_to_id: str | None,
) -> None:
    if not reply_to_id:
        return
    result = await db.execute(
        select(ChatMessage.id).where(
            ChatMessage.id == reply_to_id,
            ChatMessage.thread_id == thread_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise ValueError("reply_target_not_in_thread")


async def _active_recipients(
    db: AsyncSession,
    *,
    thread: ChatThread,
    sender_id: str,
    additional_recipient_ids: set[str] | None = None,
) -> dict[str, User]:
    project = await db.get(Project, thread.project_id)
    if project is None:
        return {}

    target_ids = {project.customer_id, project.contractor_id}
    target_ids.update(additional_recipient_ids or set())
    target_ids.update(
        (
            await db.execute(
                select(ChatThreadParticipant.user_id).where(
                    ChatThreadParticipant.thread_id == thread.id,
                    ChatThreadParticipant.status == "active",
                    ChatThreadParticipant.user_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    target_ids.discard(sender_id)
    target_ids.discard(None)
    if not target_ids:
        return {}

    users = (
        await db.execute(select(User).where(User.id.in_(list(target_ids))))
    ).scalars().all()
    return {
        user.id: user
        for user in users
        if getattr(user, "deleted_at", None) is None
    }


async def _restore_recipient_visibility(
    db: AsyncSession,
    *,
    thread_id: str,
    recipient_ids: set[str],
) -> None:
    """Incoming communication reactivates recipient inbox without changing read truth."""
    if not recipient_ids:
        return
    rows = (
        await db.execute(
            select(ChatThreadRead).where(
                ChatThreadRead.thread_id == thread_id,
                ChatThreadRead.user_id.in_(list(recipient_ids)),
            )
        )
    ).scalars().all()
    now = utc_now()
    for row in rows:
        if row.is_archived:
            row.is_archived = False
            row.updated_at = now


async def _enqueue_recipient_notifications(
    db: AsyncSession,
    *,
    message: ChatMessage,
    thread: ChatThread,
    recipients: dict[str, User],
    body: str,
) -> None:
    parent = f"chat-message:{message.id}"
    for recipient_id, recipient in recipients.items():
        await outbox.enqueue_once(
            db,
            parent_outbox_id=parent,
            effect_key=f"notify:{recipient_id}",
            aggregate_type="chat_message",
            aggregate_id=message.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": recipient_id,
                "project_id": thread.project_id,
                "notification_type": "chat_message",
                "title": f"Новое сообщение: {thread.title}",
                "body": body,
                "link_path": f"/chat/{thread.id}",
                "return_to": f"/({recipient.role.value})/(tabs)/chat",
            },
        )


async def _broadcast_after_commit(
    *,
    thread: ChatThread,
    message: ChatMessage,
    recipient_ids: set[str],
) -> None:
    """WebSocket is acceleration only; durable DB/outbox truth already committed."""
    from app.api.v1.ws import broadcast, broadcast_inbox
    from app.services import chat_service

    try:
        await broadcast(
            thread.id,
            {"type": "message", "message": chat_service.msg_dict(message)},
        )
    except Exception:
        logger.exception(
            "chat thread websocket fanout failed after commit",
            extra={"thread_id": thread.id, "message_id": message.id},
        )

    payload = {
        "type": "inbox",
        "event": "message",
        "thread_id": thread.id,
        "project_id": thread.project_id,
    }
    for recipient_id in recipient_ids:
        try:
            await broadcast_inbox(recipient_id, payload)
        except Exception:
            logger.exception(
                "chat inbox websocket fanout failed after commit",
                extra={
                    "thread_id": thread.id,
                    "message_id": message.id,
                    "recipient_id": recipient_id,
                },
            )


async def send_client_message(
    db: AsyncSession,
    *,
    thread: ChatThread,
    user_id: str,
    role: str,
    client_request_id: str,
    text: str | None,
    message_type: str = "text",
    image_data: str | None = None,
    reply_to_id: str | None = None,
    meta: dict[str, Any] | None = None,
    additional_recipient_ids: set[str] | None = None,
) -> ChatMessage:
    """Create exactly one logical client message and its durable recipient effects."""
    try:
        message_enum = ChatMessageType(message_type)
    except ValueError as exc:
        raise ValueError("invalid_message_type") from exc

    payload = _payload_identity(
        thread_id=thread.id,
        text=text,
        message_type=message_enum.value,
        image_data=image_data,
        reply_to_id=reply_to_id,
        meta=meta,
    )
    replay_id = await replay_entity_id(
        db,
        scope=MESSAGE_CREATE_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        return await _load_replay_message(db, thread_id=thread.id, entity_id=replay_id)

    await _validate_reply_target(db, thread_id=thread.id, reply_to_id=reply_to_id)

    storage_key: str | None = None
    image_url: str | None = None
    if message_enum in {ChatMessageType.photo, ChatMessageType.file} and image_data:
        # Replay is checked before external storage. A truly concurrent duplicate
        # may still produce an orphan when one DB transaction loses the ledger
        # race; ambiguous/orphan S3 recovery remains explicitly tracked by #238.
        storage_key, image_url = await storage_svc.save_image(image_data, folder="chat")

    from app.services.chat_service import _dump_meta

    message = ChatMessage(
        thread_id=thread.id,
        user_id=user_id,
        author_role=role,
        message_type=message_enum,
        text=text,
        storage_key=storage_key,
        image_url=image_url,
        reply_to_id=reply_to_id,
        meta_json=_dump_meta(meta or {}),
    )
    db.add(message)
    thread.updated_at = utc_now()
    await db.flush()

    recipients = await _active_recipients(
        db,
        thread=thread,
        sender_id=user_id,
        additional_recipient_ids=additional_recipient_ids,
    )
    recipient_ids = set(recipients)
    await _restore_recipient_visibility(
        db,
        thread_id=thread.id,
        recipient_ids=recipient_ids,
    )
    await _enqueue_recipient_notifications(
        db,
        message=message,
        thread=thread,
        recipients=recipients,
        body=text or "Вложение",
    )

    committed, canonical_id = await commit_client_write(
        db,
        scope=MESSAGE_CREATE_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=client_request_id,
        payload=payload,
        entity_id=message.id,
    )
    if not committed:
        if storage_key:
            logger.warning(
                "concurrent chat attachment candidate lost idempotency race; orphan recovery remains #238",
                extra={"storage_key": storage_key, "canonical_message_id": canonical_id},
            )
        return await _load_replay_message(
            db,
            thread_id=thread.id,
            entity_id=canonical_id,
        )

    await db.refresh(message)
    await outbox_inline_dispatch.dispatch_best_effort(
        db,
        source="chat.message",
        limit=max(10, len(recipient_ids) * 2),
    )
    await _broadcast_after_commit(
        thread=thread,
        message=message,
        recipient_ids=recipient_ids,
    )
    return message
