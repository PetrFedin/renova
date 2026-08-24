"""Чаты заказчик ↔ исполнитель + расширения OS."""
from __future__ import annotations

from app.core.timeutil import utc_now
import json
import secrets
import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.phone import normalize_phone
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    ChatThreadRead,
    DomainOutbox,
    Project,
    User,
)
from app.services import notification_service as notif_svc
from app.services import outbox_inline_dispatch
from app.services import outbox_service as outbox
from app.services import storage_service as storage_svc
from app.services.chat_invitation_delivery import delivery_status as sms_delivery_status

_CHAT_INVITE_NAMESPACE = uuid.UUID("bf4e7a2d-07c1-4a79-a7c1-e7ed1583ecb5")


def normalize_chat_title(title: str) -> str:
    return " ".join((title or "").strip().split()).lower()


async def find_thread_by_title(db: AsyncSession, project_id: str, title: str) -> ChatThread | None:
    norm = normalize_chat_title(title)
    if not norm:
        return None
    for t in await list_threads(db, project_id):
        if normalize_chat_title(t.title) == norm:
            return t
    return None


async def delete_thread(db: AsyncSession, thread_id: str) -> None:
    from sqlalchemy import delete

    thread = await get_thread(db, thread_id)
    if not thread:
        return
    await db.execute(delete(ChatThreadRead).where(ChatThreadRead.thread_id == thread_id))
    await db.execute(delete(ChatThreadParticipant).where(ChatThreadParticipant.thread_id == thread_id))
    await db.delete(thread)
    await db.flush()


def _parse_meta(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _dump_meta(meta: dict) -> str:
    return json.dumps(meta, ensure_ascii=False)


def ensure_profile_code(user: User) -> str:
    if user.profile_code:
        return user.profile_code
    code = secrets.token_hex(3).upper()[:6]
    user.profile_code = code
    return code


async def get_thread_read_state(
    db: AsyncSession,
    thread_id: str,
    user_id: str,
) -> ChatThreadRead | None:
    """Read-only lookup. GET/list/count paths must never create read state.

    ``mark_thread_read`` uses a Core upsert for database-level concurrency
    fencing. ``populate_existing`` makes a subsequent ORM lookup refresh an
    already-loaded identity-map row, so the authoritative unread response
    cannot be computed from a pre-upsert ``last_read_at`` value.
    """
    result = await db.execute(
        select(ChatThreadRead)
        .where(
            ChatThreadRead.thread_id == thread_id,
            ChatThreadRead.user_id == user_id,
        )
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _get_or_create_read(db: AsyncSession, thread_id: str, user_id: str) -> ChatThreadRead:
    """Mutation helper for pin/archive compatibility; never call from read-only paths."""
    row = await get_thread_read_state(db, thread_id, user_id)
    if row:
        return row
    # Creating a preference row must not mark history as read.
    row = ChatThreadRead(thread_id=thread_id, user_id=user_id, last_read_at=datetime(1970, 1, 1))
    db.add(row)
    await db.flush()
    return row


async def count_unread_in_thread(db: AsyncSession, thread_id: str, user_id: str) -> int:
    read_row = await get_thread_read_state(db, thread_id, user_id)
    since = read_row.last_read_at if read_row else datetime.min
    q = select(func.count()).select_from(ChatMessage).where(
        ChatMessage.thread_id == thread_id,
        ChatMessage.user_id != user_id,
        ChatMessage.created_at > since,
        ChatMessage.message_type != ChatMessageType.system,
    )
    return (await db.execute(q)).scalar() or 0


async def count_unread_project(db: AsyncSession, project_id: str, user_id: str) -> int:
    threads = await list_threads(db, project_id)
    total = 0
    for t in threads:
        state = await get_thread_read_state(db, t.id, user_id)
        if state and state.is_archived:
            continue
        total += await count_unread_in_thread(db, t.id, user_id)
    return total


async def count_unread_all(db: AsyncSession, user_id: str, project_ids: list[str]) -> int:
    total = 0
    for pid in project_ids:
        total += await count_unread_project(db, pid, user_id)
    return total


async def list_threads(db: AsyncSession, project_id: str) -> list[ChatThread]:
    r = await db.execute(
        select(ChatThread).where(ChatThread.project_id == project_id).order_by(ChatThread.updated_at.desc())
    )
    return list(r.scalars().all())


async def list_threads_enriched(db: AsyncSession, project_id: str, user_id: str) -> list[dict]:
    threads = await list_threads(db, project_id)
    out = []
    for t in threads:
        full = await get_thread(db, t.id)
        last = sorted(full.messages, key=lambda m: m.created_at)[-1] if full and full.messages else None
        state = await get_thread_read_state(db, t.id, user_id)
        unread = await count_unread_in_thread(db, t.id, user_id)
        out.append(
            thread_dict(
                t,
                last,
                unread=unread,
                is_pinned=bool(state and state.is_pinned),
                is_archived=bool(state and state.is_archived),
                pinned_at=state.pinned_at if state else None,
            )
        )
    out.sort(key=lambda x: (not x.get("is_pinned"), x.get("updated_at") or ""), reverse=True)
    return out


async def list_inbox(db: AsyncSession, user_id: str, project_ids: list[tuple[str, str]]) -> list[dict]:
    """project_ids: [(id, name), ...]"""
    inbox = []
    for pid, pname in project_ids:
        for th in await list_threads_enriched(db, pid, user_id):
            th["project_name"] = pname
            inbox.append(th)
    inbox.sort(
        key=lambda x: (
            not x.get("is_pinned"),
            x.get("pinned_at") or "",
            x.get("updated_at") or "",
        ),
        reverse=True,
    )
    return inbox


async def create_thread(db: AsyncSession, project_id: str, user_id: str, title: str, topic: str | None) -> ChatThread:
    clean_title = " ".join((title or "").strip().split())
    if not clean_title:
        raise ValueError("empty_title")
    existing = await find_thread_by_title(db, project_id, clean_title)
    if existing:
        return existing
    t = ChatThread(project_id=project_id, title=clean_title, topic=topic, created_by=user_id)
    db.add(t)
    await db.flush()
    db.add(
        ChatMessage(
            thread_id=t.id,
            user_id=user_id,
            author_role="system",
            message_type=ChatMessageType.system,
            text=f"Чат «{clean_title}» создан",
        )
    )
    await db.commit()
    await db.refresh(t)
    return t


async def get_thread(db: AsyncSession, thread_id: str) -> ChatThread | None:
    r = await db.execute(
        select(ChatThread).where(ChatThread.id == thread_id).options(selectinload(ChatThread.messages))
    )
    return r.scalar_one_or_none()


async def set_thread_state(
    db: AsyncSession,
    thread_id: str,
    user_id: str,
    *,
    is_pinned: bool | None = None,
    is_archived: bool | None = None,
) -> dict:
    row = await _get_or_create_read(db, thread_id, user_id)
    if is_pinned is not None:
        row.is_pinned = is_pinned
        row.pinned_at = utc_now() if is_pinned else None
    if is_archived is not None:
        row.is_archived = is_archived
    row.updated_at = utc_now()
    await db.commit()
    return {"is_pinned": row.is_pinned, "is_archived": row.is_archived, "pinned_at": row.pinned_at.isoformat() if row.pinned_at else None}


async def send_message(
    db: AsyncSession,
    thread: ChatThread,
    user_id: str,
    role: str,
    text: str | None,
    message_type: str = "text",
    image_data: str | None = None,
    reply_to_id: str | None = None,
    meta: dict | None = None,
) -> ChatMessage:
    storage_key, image_url = None, None
    mt = ChatMessageType(message_type)
    if mt in (ChatMessageType.photo, ChatMessageType.file) and image_data:
        storage_key, image_url = await storage_svc.save_image(image_data, folder="chat")
    msg = ChatMessage(
        thread_id=thread.id,
        user_id=user_id,
        author_role=role,
        message_type=mt,
        text=text,
        storage_key=storage_key,
        image_url=image_url,
        reply_to_id=reply_to_id,
        meta_json=_dump_meta(meta or {}),
    )
    db.add(msg)
    thread.updated_at = utc_now()
    await db.commit()
    await db.refresh(msg)

    proj = await db.get(Project, thread.project_id)
    if proj:
        targets = {proj.customer_id, proj.contractor_id}
        targets.discard(user_id)
        for target in targets:
            if target:
                await notif_svc.notify(
                    db,
                    user_id=target,
                    project_id=thread.project_id,
                    notification_type="chat_message",
                    title=f"Новое сообщение: {thread.title}",
                    body=text or "Вложение",
                    link_path=f"/chat/{thread.id}",
                    return_to="/(customer)/(tabs)/chat",
                )
    from app.api.v1.ws import broadcast, broadcast_inbox

    await broadcast(thread.id, {"type": "message", "message": msg_dict(msg)})
    if proj:
        payload = {"type": "inbox", "event": "message", "thread_id": thread.id, "project_id": thread.project_id}
        for uid in {proj.customer_id, proj.contractor_id}:
            if uid:
                await broadcast_inbox(uid, payload)
    return msg


def thread_dict(
    t: ChatThread,
    last_msg: ChatMessage | None = None,
    *,
    unread: int = 0,
    is_pinned: bool = False,
    is_archived: bool = False,
    pinned_at: datetime | None = None,
) -> dict:
    return {
        "id": t.id,
        "project_id": t.project_id,
        "title": t.title,
        "topic": t.topic,
        "updated_at": t.updated_at.isoformat(),
        "last_message": msg_dict(last_msg) if last_msg else None,
        "unread_count": unread,
        "is_pinned": is_pinned,
        "is_archived": is_archived,
        "pinned_at": pinned_at.isoformat() if pinned_at else None,
    }


def msg_dict(m: ChatMessage, read_by_other: bool = False) -> dict:
    meta = _parse_meta(m.meta_json)
    return {
        "id": m.id,
        "author_role": m.author_role,
        "message_type": m.message_type.value,
        "text": m.text,
        "image_url": m.image_url,
        "confirmed": m.confirmed,
        "created_at": m.created_at.isoformat(),
        "read": read_by_other,
        "is_pinned": m.is_pinned,
        "reply_to_id": m.reply_to_id,
        "reactions": meta.get("reactions", {}),
        "work_order_id": meta.get("work_order_id") or meta.get("linked_task_id"),
        "payment_id": meta.get("payment_id"),
        "file_name": meta.get("file_name"),
        "assignee_id": meta.get("assignee_id"),
        "due_at": meta.get("due_at"),
    }


async def _resolve_read_cursor(
    db: AsyncSession,
    thread_id: str,
    read_through_message_id: str | None,
) -> ChatMessage | None:
    if read_through_message_id:
        result = await db.execute(
            select(ChatMessage).where(
                ChatMessage.id == read_through_message_id,
                ChatMessage.thread_id == thread_id,
            )
        )
        message = result.scalar_one_or_none()
        if not message:
            raise ValueError("read_cursor_not_in_thread")
        return message

    # Internal/dev callers may intentionally mark through the current transcript.
    # Never use request time as a cursor: only an existing server-authored message.
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def mark_thread_read(
    db: AsyncSession,
    thread_id: str,
    user_id: str,
    read_through_message_id: str | None = None,
) -> int:
    """Advance read state monotonically to an authoritative message cursor.

    The upsert predicate is the concurrency fence: an older/equal concurrent
    request cannot overwrite a newer cursor. The public API always supplies a
    message id; the optional form exists only for deterministic seed/test code.
    """
    target = await _resolve_read_cursor(db, thread_id, read_through_message_id)
    if not target:
        return await count_unread_in_thread(db, thread_id, user_id)

    target_at = target.created_at
    now = utc_now()
    dialect = db.bind.dialect.name if db.bind is not None else ""

    if dialect in {"postgresql", "sqlite"}:
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(ChatThreadRead).values(
            thread_id=thread_id,
            user_id=user_id,
            last_read_at=target_at,
            updated_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[ChatThreadRead.user_id, ChatThreadRead.thread_id],
            set_={"last_read_at": target_at, "updated_at": now},
            where=ChatThreadRead.last_read_at < target_at,
        )
        await db.execute(stmt)
    else:
        # Non-production fallback for unsupported SQLAlchemy dialects. The lock
        # preserves monotonicity for an existing row; production uses Postgres.
        result = await db.execute(
            select(ChatThreadRead)
            .where(
                ChatThreadRead.thread_id == thread_id,
                ChatThreadRead.user_id == user_id,
            )
            .with_for_update()
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = ChatThreadRead(
                thread_id=thread_id,
                user_id=user_id,
                last_read_at=target_at,
            )
            db.add(row)
        elif row.last_read_at < target_at:
            row.last_read_at = target_at
            row.updated_at = now

    await db.commit()
    return await count_unread_in_thread(db, thread_id, user_id)


async def read_map(db: AsyncSession, thread_id: str) -> dict[str, datetime]:
    r = await db.execute(select(ChatThreadRead).where(ChatThreadRead.thread_id == thread_id))
    return {x.user_id: x.last_read_at for x in r.scalars().all()}


async def toggle_reaction(db: AsyncSession, message_id: str, user_id: str, emoji: str) -> dict:
    msg = await db.get(ChatMessage, message_id)
    if not msg:
        return {}
    meta = _parse_meta(msg.meta_json)
    reactions: dict = meta.setdefault("reactions", {})
    users = reactions.setdefault(emoji, [])
    if user_id in users:
        users.remove(user_id)
        if not users:
            reactions.pop(emoji, None)
    else:
        users.append(user_id)
    msg.meta_json = _dump_meta(meta)
    await db.commit()
    from app.api.v1.ws import broadcast

    await broadcast(msg.thread_id, {"type": "reaction", "message_id": message_id, "reactions": reactions})
    return reactions


async def pin_message(db: AsyncSession, message_id: str, pin: bool = True) -> ChatMessage | None:
    msg = await db.get(ChatMessage, message_id)
    if not msg:
        return None
    if pin:
        r = await db.execute(select(ChatMessage).where(ChatMessage.thread_id == msg.thread_id, ChatMessage.is_pinned == True))
        for other in r.scalars().all():
            other.is_pinned = False
    msg.is_pinned = pin
    await db.commit()
    await db.refresh(msg)
    return msg


async def list_participants(db: AsyncSession, thread_id: str) -> list[dict]:
    r = await db.execute(select(ChatThreadParticipant).where(ChatThreadParticipant.thread_id == thread_id))
    out = []
    for p in r.scalars().all():
        u = await db.get(User, p.user_id) if p.user_id else None
        out.append({
            "id": p.id,
            "user_id": p.user_id,
            "phone": p.phone or (u.phone if u else None),
            "profile_code": p.profile_code or (u.profile_code if u else None),
            "full_name": u.full_name if u else None,
            "status": p.status,
        })
    return out


def _participant_id(thread_id: str, target_key: str) -> str:
    return str(uuid.uuid5(_CHAT_INVITE_NAMESPACE, f"{thread_id}:{target_key}"))


async def _existing_participant(
    db: AsyncSession,
    thread_id: str,
    *,
    target: User | None,
    normalized_phone: str | None,
) -> ChatThreadParticipant | None:
    if target is not None:
        row = (
            await db.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.thread_id == thread_id,
                    ChatThreadParticipant.user_id == target.id,
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            return row
    if normalized_phone:
        return (
            await db.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.thread_id == thread_id,
                    ChatThreadParticipant.phone == normalized_phone,
                )
                .order_by(ChatThreadParticipant.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
    return None


async def _ensure_participant(
    db: AsyncSession,
    thread: ChatThread,
    inviter: User,
    *,
    target: User | None,
    normalized_phone: str | None,
    profile_code: str | None,
) -> ChatThreadParticipant:
    existing = await _existing_participant(
        db,
        thread.id,
        target=target,
        normalized_phone=normalized_phone,
    )
    if existing is not None:
        if target is not None and existing.user_id is None:
            existing.user_id = target.id
            existing.status = "active"
        if profile_code and not existing.profile_code:
            existing.profile_code = profile_code
        return existing

    target_key = f"user:{target.id}" if target else f"phone:{normalized_phone}"
    part_id = _participant_id(thread.id, target_key)
    values = {
        "id": part_id,
        "thread_id": thread.id,
        "user_id": target.id if target else None,
        "phone": normalized_phone,
        "profile_code": profile_code,
        "invited_by": inviter.id,
        "status": "active" if target else "pending",
        "created_at": utc_now(),
    }
    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect in {"postgresql", "sqlite"}:
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        await db.execute(
            insert_fn(ChatThreadParticipant)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[ChatThreadParticipant.id])
        )
        participant = await db.get(ChatThreadParticipant, part_id)
        if participant is None:
            raise RuntimeError("chat_invitation_participant_insert_failed")
        return participant

    participant = ChatThreadParticipant(**values)
    db.add(participant)
    await db.flush()
    return participant


async def _refresh_outbox(db: AsyncSession, outbox_id: str) -> DomainOutbox | None:
    return (
        await db.execute(
            select(DomainOutbox)
            .where(DomainOutbox.id == outbox_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


def _in_app_delivery_status(row: DomainOutbox | None) -> str:
    if row is None:
        return "not_queued"
    if row.processed_at is not None:
        return "in_app_notified"
    if int(row.attempts or 0) >= outbox.MAX_ATTEMPTS:
        return "in_app_failed_terminal"
    if int(row.attempts or 0) > 0:
        return "in_app_retrying"
    return "in_app_queued"


async def invite_participant(
    db: AsyncSession,
    thread: ChatThread,
    inviter: User,
    *,
    phone: str | None = None,
    profile_code: str | None = None,
) -> dict:
    """Create/adopt one invitation and persist delivery intent atomically."""
    if bool(phone) == bool(profile_code):
        raise ValueError("invite_requires_exactly_one_target")

    normalized_phone: str | None = None
    target: User | None = None
    normalized_code = profile_code.strip().upper() if profile_code else None
    if normalized_code:
        target = (
            await db.execute(select(User).where(User.profile_code == normalized_code))
        ).scalar_one_or_none()
        if target is None:
            raise ValueError("invite_profile_not_found")
    else:
        try:
            normalized_phone = normalize_phone(phone or "")
        except ValueError as exc:
            raise ValueError("invite_phone_invalid") from exc
        target = (
            await db.execute(select(User).where(User.phone == normalized_phone))
        ).scalar_one_or_none()

    if target is not None and target.id == inviter.id:
        raise ValueError("invite_self_not_allowed")

    participant = await _ensure_participant(
        db,
        thread,
        inviter,
        target=target,
        normalized_phone=normalized_phone,
        profile_code=normalized_code,
    )

    invite_text = (
        f"Вас пригласили в чат «{thread.title}». "
        "Установите Renova, зарегистрируйтесь — чат появится в разделе Сообщения."
    )
    delivery_parent = f"chat-invite:{participant.id}"
    if target is not None:
        delivery = await outbox.enqueue_once(
            db,
            parent_outbox_id=delivery_parent,
            effect_key="delivery:in_app",
            aggregate_type="chat_invitation",
            aggregate_id=participant.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": target.id,
                "project_id": thread.project_id,
                "notification_type": "chat_message",
                "title": "Приглашение в чат",
                "body": invite_text,
                "link_path": f"/chat/{thread.id}",
                "return_to": "/(customer)/(tabs)/chat",
            },
        )
        delivery_channel = "in_app"
    else:
        delivery = await outbox.enqueue_once(
            db,
            parent_outbox_id=delivery_parent,
            effect_key="delivery:sms",
            aggregate_type="chat_invitation",
            aggregate_id=participant.id,
            event_type=outbox.CHAT_INVITATION_SMS_EVENT,
            payload={"participant_id": participant.id},
        )
        delivery_channel = "sms"

    await outbox.enqueue_once(
        db,
        parent_outbox_id=delivery_parent,
        effect_key="activity:invited",
        aggregate_type="chat_invitation",
        aggregate_id=participant.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": thread.project_id,
            "user_id": inviter.id,
            "kind": "ChatParticipantInvited",
            "title": "Участник приглашён в чат",
            "body": thread.title,
            "link_path": f"/chat/{thread.id}",
        },
    )

    # Participant + delivery intent + audit/activity intent are one durable commit.
    await db.commit()

    # Acceleration is optional. Failure here never rolls back the accepted
    # invitation; the canonical worker/DLQ owns delivery and recovery.
    await outbox_inline_dispatch.dispatch_best_effort(
        db,
        source="chat.invitation",
        limit=10,
    )
    delivery = await _refresh_outbox(db, delivery.id)
    delivery_state = (
        _in_app_delivery_status(delivery)
        if delivery_channel == "in_app"
        else sms_delivery_status(delivery)
    )
    return {
        "id": participant.id,
        "status": participant.status,
        "user_id": participant.user_id,
        "delivery_channel": delivery_channel,
        "delivery_status": delivery_state,
        "delivery_outbox_id": delivery.id if delivery else None,
    }


async def create_task_from_message(
    db: AsyncSession,
    thread: ChatThread,
    user_id: str,
    role: str,
    message_id: str,
    *,
    title: str,
    assignee_id: str | None,
    due_at: str | None,
    work_type: str = "general",
) -> ChatMessage:
    from datetime import date
    from app.services import work_order_service as wo_svc

    due = date.fromisoformat(due_at[:10]) if due_at else None
    wo = await wo_svc.create_work_order(
        db,
        project_id=thread.project_id,
        user_id=user_id,
        title=title,
        work_type=work_type,
        planned_start=due,
        planned_end=due,
        publish=True,
    )
    if assignee_id:
        wo.assignee_id = assignee_id
        await db.commit()

    text = f"📋 Задача: {title}" + (f" · до {due_at[:10]}" if due_at else "")
    meta = {"work_order_id": wo.id, "assignee_id": assignee_id, "due_at": due_at}
    msg = await send_message(db, thread, user_id, role, text, "task", meta=meta)
    orig = await db.get(ChatMessage, message_id)
    if orig:
        om = _parse_meta(orig.meta_json)
        om["linked_task_id"] = wo.id
        orig.meta_json = _dump_meta(om)
        await db.commit()
    return msg


async def create_payment_message(
    db: AsyncSession,
    thread: ChatThread,
    user_id: str,
    role: str,
    *,
    title: str,
    amount: float,
    payment_type: str,
) -> ChatMessage:
    from app.services import payment_service as pay_svc

    pay = await pay_svc.create_payment(db, thread.project_id, user_id, title, amount, payment_type)
    text = f"💳 Счёт: {title} · {amount:.0f} ₽"
    meta = {"payment_id": pay.id, "amount": amount}
    return await send_message(db, thread, user_id, role, text, "payment", meta=meta)