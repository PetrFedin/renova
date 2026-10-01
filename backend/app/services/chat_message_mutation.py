"""Atomic, idempotent client-originated chat message mutation."""
from __future__ import annotations

import hashlib
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ChatMessage, ChatMessageType, ChatThread, ChatThreadParticipant, ChatThreadRead, Project, User
from app.services import outbox_inline_dispatch
from app.services import outbox_service as outbox
from app.services import storage_service as storage_svc
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

logger = logging.getLogger(__name__)
MESSAGE_CREATE_SCOPE = "chat.message.create"


def _payload_identity(*, thread_id: str, text: str | None, message_type: str, image_data: str | None, reply_to_id: str | None, meta: dict[str, Any] | None) -> dict[str, Any]:
    return {"thread_id": thread_id, "text": text, "message_type": message_type, "image_sha256": hashlib.sha256(image_data.encode("utf-8")).hexdigest() if image_data is not None else None, "reply_to_id": reply_to_id, "meta": meta or {}}


async def _load_replay_message(db: AsyncSession, *, thread_id: str, entity_id: str) -> ChatMessage:
    message = await db.get(ChatMessage, entity_id)
    if message is None or message.thread_id != thread_id:
        raise RuntimeError("chat_message_idempotency_ledger_corrupt")
    return message


async def _validate_reply_target(db: AsyncSession, *, thread_id: str, reply_to_id: str | None) -> None:
    if not reply_to_id:
        return
    result = await db.execute(select(ChatMessage.id).where(ChatMessage.id == reply_to_id, ChatMessage.thread_id == thread_id))
    if result.scalar_one_or_none() is None:
        raise ValueError("reply_target_not_in_thread")


async def _active_recipients(db: AsyncSession, *, thread: ChatThread, sender_id: str, additional_recipient_ids: set[str] | None = None) -> dict[str, User]:
    project = await db.get(Project, thread.project_id)
    if project is None:
        return {}
    target_ids = {project.customer_id, project.contractor_id}
    target_ids.update(additional_recipient_ids or set())
    target_ids.update((await db.execute(select(ChatThreadParticipant.user_id).where(ChatThreadParticipant.thread_id == thread.id, ChatThreadParticipant.status == "active", ChatThreadParticipant.user_id.is_not(None)))).scalars().all())
    target_ids.discard(sender_id)
    target_ids.discard(None)
    if not target_ids:
        return {}
    users = (await db.execute(select(User).where(User.id.in_(list(target_ids))))).scalars().all()
    return {user.id: user for user in users if getattr(user, "deleted_at", None) is None}


async def _restore_recipient_visibility(db: AsyncSession, *, thread_id: str, recipient_ids: set[str]) -> None:
    if not recipient_ids:
        return
    rows = (await db.execute(select(ChatThreadRead).where(ChatThreadRead.thread_id == thread_id, ChatThreadRead.user_id.in_(list(recipient_ids))))).scalars().all()
    now = utc_now()
    for row in rows:
        if row.is_archived:
            row.is_archived = False
            row.updated_at = now


async def _enqueue_recipient_notifications(db: AsyncSession, *, message: ChatMessage, thread: ChatThread, recipients: dict[str, User], body: str) -> None:
    parent = f"chat-message:{message.id}"
    for recipient_id, recipient in recipients.items():
        await outbox.enqueue_once(db, parent_outbox_id=parent, effect_key=f"notify:{recipient_id}", aggregate_type="chat_message", aggregate_id=message.id, event_type=outbox.NOTIFICATION_EVENT, payload={"user_id": recipient_id, "project_id": thread.project_id, "notification_type": "chat_message", "title": f"Новое сообщение: {thread.title}", "body": body, "link_path": f"/chat/{thread.id}", "return_to": f"/({recipient.role.value})/(tabs)/chat"})


async def _broadcast_after_commit(*, thread_id: str, project_id: str, message: ChatMessage, recipient_ids: set[str]) -> None:
    from app.api.v1.ws import broadcast, broadcast_inbox
    from app.services import chat_service
    try:
        await broadcast(thread_id, {"type": "message", "message": chat_service.msg_dict(message)})
    except Exception:
        logger.exception("chat thread websocket fanout failed after commit", extra={"thread_id": thread_id, "message_id": message.id})
    payload = {"type": "inbox", "event": "message", "thread_id": thread_id, "project_id": project_id}
    for recipient_id in recipient_ids:
        try:
            await broadcast_inbox(recipient_id, payload)
        except Exception:
            logger.exception("chat inbox websocket fanout failed after commit", extra={"thread_id": thread_id, "message_id": message.id, "recipient_id": recipient_id})


async def send_client_message(db: AsyncSession, *, thread: ChatThread, user_id: str, role: str, client_request_id: str, text: str | None, message_type: str = "text", image_data: str | None = None, reply_to_id: str | None = None, meta: dict[str, Any] | None = None, additional_recipient_ids: set[str] | None = None) -> ChatMessage:
    # Capture immutable identifiers before any operation that may roll back and
    # expire ORM state. A concurrent idempotency loser must never trigger
    # implicit async ORM I/O while resolving the canonical winner.
    thread_id = str(thread.id)
    project_id = str(thread.project_id)
    try:
        message_enum = ChatMessageType(message_type)
    except ValueError as exc:
        raise ValueError("invalid_message_type") from exc
    payload = _payload_identity(thread_id=thread_id, text=text, message_type=message_enum.value, image_data=image_data, reply_to_id=reply_to_id, meta=meta)
    replay_id = await replay_entity_id(db, scope=MESSAGE_CREATE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload)
    if replay_id:
        return await _load_replay_message(db, thread_id=thread_id, entity_id=replay_id)
    await _validate_reply_target(db, thread_id=thread_id, reply_to_id=reply_to_id)
    storage_key = image_url = None
    if message_enum in {ChatMessageType.photo, ChatMessageType.file} and image_data:
        storage_key, image_url = await storage_svc.save_image(image_data, folder=f"chat-media/{thread_id}")
    from app.services.chat_service import _dump_meta
    message = ChatMessage(thread_id=thread_id, user_id=user_id, author_role=role, message_type=message_enum, text=text, storage_key=storage_key, image_url=image_url, reply_to_id=reply_to_id, meta_json=_dump_meta(meta or {}))
    db.add(message)
    thread.updated_at = utc_now()
    await db.flush()
    recipients = await _active_recipients(db, thread=thread, sender_id=user_id, additional_recipient_ids=additional_recipient_ids)
    recipient_ids = set(recipients)
    await _restore_recipient_visibility(db, thread_id=thread_id, recipient_ids=recipient_ids)
    await _enqueue_recipient_notifications(db, message=message, thread=thread, recipients=recipients, body=text or "Вложение")
    committed, canonical_id = await commit_client_write(db, scope=MESSAGE_CREATE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload, entity_id=message.id)
    if not committed:
        if storage_key:
            logger.warning("concurrent chat attachment candidate lost idempotency race; orphan recovery remains #238", extra={"storage_key": storage_key, "canonical_message_id": canonical_id})
        return await _load_replay_message(db, thread_id=thread_id, entity_id=canonical_id)
    await db.refresh(message)
    await outbox_inline_dispatch.dispatch_best_effort(db, source="chat.message", limit=max(10, len(recipient_ids) * 2))
    await _broadcast_after_commit(thread_id=thread_id, project_id=project_id, message=message, recipient_ids=recipient_ids)
    return message


# --- COM-006: edit / soft-delete of the author's own message -----------------
#
# Policy (documented, no migration: state lives in ``meta_json``):
#   * only the AUTHOR may edit or delete their message (nobody else, including
#     the project owner; moderation of other people's text is a product decision);
#   * edit: plain ``text`` messages only, within EDIT_WINDOW (24h) of creation;
#     stamps ``edited_at``; editing identical text is an idempotent no-op;
#   * delete: soft, any time, for user-originated types (text/photo/file/confirm).
#     Text/attachment are wiped from the row and ``meta_json.deleted_at`` is set;
#     the row stays so reply chains, reads and pins keep their anchors. Repeating
#     the delete returns the same state;
#   * service messages (system/task/payment/invoice) are never editable/deletable.
EDIT_WINDOW = timedelta(hours=24)
EDITABLE_TYPES = {ChatMessageType.text}
DELETABLE_TYPES = {ChatMessageType.text, ChatMessageType.photo, ChatMessageType.file, ChatMessageType.confirm}
MAX_TEXT_LENGTH = 8000


class MessageMutationError(ValueError):
    """Carries a stable machine code; the API maps it to an HTTP status."""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


async def _lock_message(db: AsyncSession, message_id: str) -> ChatMessage:
    row = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.id == message_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        raise MessageMutationError("message_not_found", 404)
    return row


async def _broadcast_updated(thread: ChatThread, message: ChatMessage, event: str) -> None:
    from app.api.v1.ws import broadcast
    from app.services import chat_service

    try:
        await broadcast(thread.id, {"type": event, "message": chat_service.msg_dict(message)})
    except Exception:
        logger.exception("chat %s websocket fanout failed", event, extra={"thread_id": thread.id, "message_id": message.id})


async def edit_own_message(db: AsyncSession, *, thread: ChatThread, message_id: str, user_id: str, text: str) -> ChatMessage:
    from app.services.chat_service import _dump_meta, _parse_meta

    clean = (text or "").strip()
    if not clean or len(clean) > MAX_TEXT_LENGTH:
        raise MessageMutationError("invalid_message_text", 422)
    message = await _lock_message(db, message_id)
    if message.thread_id != thread.id:
        raise MessageMutationError("message_not_found", 404)
    if message.user_id != user_id:
        raise MessageMutationError("only_author_can_edit_message", 403)
    meta = _parse_meta(message.meta_json)
    if meta.get("deleted_at"):
        raise MessageMutationError("message_deleted", 409)
    if message.message_type not in EDITABLE_TYPES:
        raise MessageMutationError("message_type_not_editable", 409)
    if message.text == clean:
        await db.commit()  # release the row lock; identical edit is a no-op
        await db.refresh(message)
        return message
    if utc_now() - message.created_at > EDIT_WINDOW:
        raise MessageMutationError("edit_window_expired", 409)
    message.text = clean
    meta["edited_at"] = utc_now().isoformat()
    message.meta_json = _dump_meta(meta)
    await db.commit()
    await db.refresh(message)
    await _broadcast_updated(thread, message, "message_edited")
    return message


async def delete_own_message(db: AsyncSession, *, thread: ChatThread, message_id: str, user_id: str) -> ChatMessage:
    from app.services.chat_service import _dump_meta, _parse_meta

    message = await _lock_message(db, message_id)
    if message.thread_id != thread.id:
        raise MessageMutationError("message_not_found", 404)
    if message.user_id != user_id:
        raise MessageMutationError("only_author_can_delete_message", 403)
    meta = _parse_meta(message.meta_json)
    if meta.get("deleted_at"):
        await db.commit()  # idempotent repeat; releases the row lock
        await db.refresh(message)
        return message
    if message.message_type not in DELETABLE_TYPES:
        raise MessageMutationError("message_type_not_deletable", 409)
    message.text = None
    message.image_url = None
    message.storage_key = None
    message.is_pinned = False
    meta["deleted_at"] = utc_now().isoformat()
    meta["deleted_by"] = user_id
    meta.pop("reactions", None)
    message.meta_json = _dump_meta(meta)
    await db.commit()
    await db.refresh(message)
    await _broadcast_updated(thread, message, "message_deleted")
    return message


# --- COM-010: confirmation of an approval request ---------------------------

async def confirm_request_message(db: AsyncSession, *, thread: ChatThread, message_id: str, user: User) -> tuple[ChatMessage, bool]:
    """Record who/when confirmed a ``confirm`` message and tell its author.

    Returns ``(message, newly_confirmed)``. Self-confirmation is refused (the
    author cannot approve their own request). A repeat by anyone is an
    idempotent replay: state and the single author notification are unchanged.
    """
    from app.services.chat_service import _dump_meta, _parse_meta

    message = await _lock_message(db, message_id)
    if message.thread_id != thread.id:
        raise MessageMutationError("message_not_found", 404)
    if message.message_type != ChatMessageType.confirm:
        raise MessageMutationError("not_a_confirmation_request", 400)
    meta = _parse_meta(message.meta_json)
    if meta.get("deleted_at"):
        raise MessageMutationError("message_deleted", 409)
    if message.user_id == user.id:
        raise MessageMutationError("cannot_confirm_own_request", 403)
    if message.confirmed:
        await db.commit()
        await db.refresh(message)
        return message, False
    now = utc_now()
    message.confirmed = True
    meta["confirmed_by"] = user.id
    meta["confirmed_at"] = now.isoformat()
    message.meta_json = _dump_meta(meta)
    author = await db.get(User, message.user_id)
    if author is not None and getattr(author, "deleted_at", None) is None:
        who = user.full_name or "Участник"
        await outbox.enqueue_once(
            db,
            parent_outbox_id=f"chat-confirm:{message.id}",
            effect_key=f"notify:{author.id}",
            aggregate_type="chat_message",
            aggregate_id=message.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": author.id,
                "project_id": thread.project_id,
                "notification_type": "chat_message",
                "title": f"Согласование подтверждено: {thread.title}",
                "body": f"{who} подтвердил(а): {message.text or 'запрос'}",
                "link_path": f"/chat/{thread.id}",
                "return_to": f"/({author.role.value})/(tabs)/chat",
            },
        )
    await outbox.enqueue_once(
        db,
        parent_outbox_id=f"chat-confirm:{message.id}",
        effect_key="activity:confirmed",
        aggregate_type="chat_message",
        aggregate_id=message.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": thread.project_id,
            "user_id": user.id,
            "kind": "ChatRequestConfirmed",
            "title": "Согласование подтверждено в чате",
            "body": thread.title,
            "link_path": f"/chat/{thread.id}",
        },
    )
    await db.commit()
    await db.refresh(message)
    await outbox_inline_dispatch.dispatch_best_effort(db, source="chat.confirm", limit=10)
    await _broadcast_updated(thread, message, "message_updated")
    from app.api.v1.ws import broadcast_inbox

    try:
        await broadcast_inbox(message.user_id, {"type": "inbox", "event": "message", "thread_id": thread.id, "project_id": thread.project_id})
    except Exception:
        logger.exception("chat confirm inbox fanout failed")
    return message, True
