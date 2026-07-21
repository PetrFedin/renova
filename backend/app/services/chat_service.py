"""Чаты заказчик ↔ исполнитель + расширения OS."""
from __future__ import annotations

from app.core.timeutil import utc_now
import json
import secrets
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    ChatThreadRead,
    Project,
    User,
)
from app.services import notification_service as notif_svc
from app.services import storage_service as storage_svc


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


async def _get_or_create_read(db: AsyncSession, thread_id: str, user_id: str) -> ChatThreadRead:
    r = await db.execute(
        select(ChatThreadRead).where(ChatThreadRead.thread_id == thread_id, ChatThreadRead.user_id == user_id)
    )
    row = r.scalar_one_or_none()
    if row:
        return row
    # Не ставим utcnow(): иначе первое появление строки (inbox/pin) ложно «прочитывает» историю.
    # Прочтение — только mark_thread_read / открытие треда (GET chat).
    row = ChatThreadRead(thread_id=thread_id, user_id=user_id, last_read_at=datetime(1970, 1, 1))
    db.add(row)
    await db.flush()
    return row


async def count_unread_in_thread(db: AsyncSession, thread_id: str, user_id: str) -> int:
    r = await db.execute(select(ChatThreadRead).where(ChatThreadRead.thread_id == thread_id, ChatThreadRead.user_id == user_id))
    read_row = r.scalar_one_or_none()
    since = read_row.last_read_at if read_row else datetime.min
    q = select(func.count()).select_from(ChatMessage).where(
        ChatMessage.thread_id == thread_id,
        ChatMessage.user_id != user_id,
        ChatMessage.created_at > since,
        ChatMessage.message_type != ChatMessageType.system,
    )
    return (await db.execute(q)).scalar() or 0


async def count_unread_project(db: AsyncSession, project_id: str, user_id: str) -> int:
    """Global unread = только НЕ архивные треды.

    Политика: leftover unread в архиве виден в папке «Архив» и не кормит dock badge.
    Новое входящее снимает archive → тогда счётчик входит в total.
    """
    threads = await list_threads(db, project_id)
    total = 0
    for t in threads:
        st = await _get_or_create_read(db, t.id, user_id)
        if st.is_archived:
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
        st = await _get_or_create_read(db, t.id, user_id)
        unread = await count_unread_in_thread(db, t.id, user_id)
        out.append(
            thread_dict(
                t,
                last,
                unread=unread,
                is_pinned=st.is_pinned,
                is_archived=st.is_archived,
                pinned_at=st.pinned_at,
                archived_at=getattr(st, "archived_at", None),
                muted_until=getattr(st, "muted_until", None),
                is_muted=_is_muted(st),
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


def _is_muted(row: ChatThreadRead, *, now: datetime | None = None) -> bool:
    """Mute отдельно от archive: push подавляются, unread считается."""
    until = getattr(row, "muted_until", None)
    if not until:
        return False
    return until > (now or utc_now())


async def unarchive_recipients(
    db: AsyncSession,
    thread_id: str,
    *,
    except_user_id: str | None = None,
    user_ids: list[str] | None = None,
) -> list[str]:
    """Снять archive у получателей (не трогает last_read_at / muted_until).

    Возвращает user_id, у кого архив реально снят (для события).
    """
    changed: list[str] = []
    targets = user_ids or []
    for uid in targets:
        if not uid or uid == except_user_id:
            continue
        row = await _get_or_create_read(db, thread_id, uid)
        if row.is_archived:
            row.is_archived = False
            row.archived_at = None
            row.updated_at = utc_now()
            changed.append(uid)
    return changed


async def set_thread_state(
    db: AsyncSession,
    thread_id: str,
    user_id: str,
    *,
    is_pinned: bool | None = None,
    is_archived: bool | None = None,
    muted_until: datetime | None | object = ...,
) -> dict:
    """Меняет pin/archive/mute. Архивация НЕ сдвигает last_read_at (archive ≠ read)."""
    row = await _get_or_create_read(db, thread_id, user_id)
    now = utc_now()
    if is_pinned is not None:
        row.is_pinned = is_pinned
        row.pinned_at = now if is_pinned else None
    if is_archived is not None:
        # Не трогаем last_read_at — непрочитанные остаются до read / нового события
        row.is_archived = is_archived
        row.archived_at = now if is_archived else None
    if muted_until is not ...:
        row.muted_until = muted_until  # type: ignore[assignment]
    row.updated_at = now
    await db.commit()
    return {
        "is_pinned": row.is_pinned,
        "is_archived": row.is_archived,
        "archived_at": row.archived_at.isoformat() if row.archived_at else None,
        "muted_until": row.muted_until.isoformat() if row.muted_until else None,
        "is_muted": _is_muted(row, now=now),
        "pinned_at": row.pinned_at.isoformat() if row.pinned_at else None,
        # Явно: archive action не меняет read cursor
        "last_read_at": row.last_read_at.isoformat() if row.last_read_at else None,
    }


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

    # Атомарно с сообщением: снять archive у получателей (политика auto-unarchive).
    # Mute не снимаем; last_read_at не трогаем.
    proj = await db.get(Project, thread.project_id)
    recipient_ids: list[str] = []
    unarchived_for: list[str] = []
    if proj:
        recipient_ids = [uid for uid in {proj.customer_id, proj.contractor_id} if uid and uid != user_id]
        unarchived_for = await unarchive_recipients(
            db,
            thread.id,
            except_user_id=user_id,
            user_ids=recipient_ids,
        )

    await db.commit()
    await db.refresh(msg)

    if proj:
        for target in recipient_ids:
            st = await _get_or_create_read(db, thread.id, target)
            # Mute ≠ archive: при mute push не шлём, unread всё равно вырастет
            if _is_muted(st):
                continue
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
        payload = {
            "type": "inbox",
            "event": "message",
            "thread_id": thread.id,
            "project_id": thread.project_id,
            # Клиент: убрать из archive без дубликата, включить в global unread
            "unarchived": True,
            "unarchived_for": unarchived_for,
        }
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
    archived_at: datetime | None = None,
    muted_until: datetime | None = None,
    is_muted: bool = False,
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
        "archived_at": archived_at.isoformat() if archived_at else None,
        "muted_until": muted_until.isoformat() if muted_until else None,
        "is_muted": is_muted,
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


async def mark_thread_read(db: AsyncSession, thread_id: str, user_id: str) -> None:
    row = await _get_or_create_read(db, thread_id, user_id)
    now = utc_now()
    row.last_read_at = now
    row.updated_at = now
    await db.commit()


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


async def invite_participant(
    db: AsyncSession,
    thread: ChatThread,
    inviter: User,
    *,
    phone: str | None = None,
    profile_code: str | None = None,
) -> dict:
    target: User | None = None
    if profile_code:
        r = await db.execute(select(User).where(User.profile_code == profile_code.upper()))
        target = r.scalar_one_or_none()
    elif phone:
        r = await db.execute(select(User).where(User.phone == phone))
        target = r.scalar_one_or_none()

    part = ChatThreadParticipant(
        thread_id=thread.id,
        user_id=target.id if target else None,
        phone=phone,
        profile_code=profile_code.upper() if profile_code else None,
        invited_by=inviter.id,
        status="active" if target else "pending",
    )
    db.add(part)
    await db.flush()

    invite_text = f"Вас пригласили в чат «{thread.title}». Установите Renova, зарегистрируйтесь — чат появится в разделе Сообщения."
    if target:
        await notif_svc.notify(
            db,
            user_id=target.id,
            project_id=thread.project_id,
            notification_type="chat_message",
            title="Приглашение в чат",
            body=invite_text,
            link_path=f"/chat/{thread.id}",
            return_to="/(customer)/(tabs)/chat",
        )
    elif phone:
        try:
            from app.services.sms_service import send_sms
            await send_sms(phone, invite_text)
        except Exception:
            pass

    await db.commit()
    return {"id": part.id, "status": part.status, "user_id": part.user_id}


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
