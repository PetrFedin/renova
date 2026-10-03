"""Чаты заказчик ↔ исполнитель + расширения OS."""
from __future__ import annotations

from app.core.legacy_text import localize_due_dates
from app.core.timeutil import utc_now
import json
import secrets
import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
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
    Team,
    TeamMember,
    User,
)
from app.services import notification_service as notif_svc
from app.services import outbox_inline_dispatch
from app.services import outbox_service as outbox
from app.services import storage_service as storage_svc
from app.services.chat_invitation_delivery import delivery_status as sms_delivery_status

# COM-006: участник вышел сам ("left") или удалён создателем/заказчиком ("removed").
INACTIVE_PARTICIPANT_STATUSES = ("left", "removed")

_CHAT_INVITE_NAMESPACE = uuid.UUID("bf4e7a2d-07c1-4a79-a7c1-e7ed1583ecb5")


def normalize_chat_title(title: str) -> str:
    return " ".join((title or "").strip().split()).lower()


def _ru_date(iso: str) -> str:
    """«2026-10-05[T…]» -> «05.10.2026»; нераспознанное отдаём как есть."""
    head = (iso or "")[:10]
    parts = head.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return head


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


async def unread_counts_for_threads(
    db: AsyncSession,
    thread_ids: list[str],
    user_id: str,
) -> dict[str, int]:
    """Unread per thread in ONE grouped query (COM-024), same rule as ``count_unread_in_thread``."""
    if not thread_ids:
        return {}
    since = func.coalesce(ChatThreadRead.last_read_at, datetime(1970, 1, 1))
    q = (
        select(ChatMessage.thread_id, func.count())
        .select_from(ChatMessage)
        .outerjoin(
            ChatThreadRead,
            and_(ChatThreadRead.thread_id == ChatMessage.thread_id, ChatThreadRead.user_id == user_id),
        )
        .where(
            ChatMessage.thread_id.in_(thread_ids),
            ChatMessage.user_id != user_id,
            ChatMessage.created_at > since,
            ChatMessage.message_type != ChatMessageType.system,
        )
        .group_by(ChatMessage.thread_id)
    )
    return {tid: int(n) for tid, n in (await db.execute(q)).all()}


async def last_messages_for_threads(db: AsyncSession, thread_ids: list[str]) -> dict[str, ChatMessage]:
    """Latest message per thread without loading history (window function)."""
    if not thread_ids:
        return {}
    rn = func.row_number().over(
        partition_by=ChatMessage.thread_id,
        order_by=(ChatMessage.created_at.desc(), ChatMessage.id.desc()),
    ).label("rn")
    ranked = select(ChatMessage.id.label("mid"), rn).where(ChatMessage.thread_id.in_(thread_ids)).subquery()
    rows = await db.execute(
        select(ChatMessage).join(ranked, ranked.c.mid == ChatMessage.id).where(ranked.c.rn == 1)
    )
    return {m.thread_id: m for m in rows.scalars().all()}


async def count_unread_project(db: AsyncSession, project_id: str, user_id: str, *, hide_money: bool = False) -> int:
    threads = await list_threads(db, project_id, hide_money=hide_money)
    ids = [t.id for t in threads]
    if not ids:
        return 0
    reads = await db.execute(
        select(ChatThreadRead.thread_id).where(
            ChatThreadRead.thread_id.in_(ids),
            ChatThreadRead.user_id == user_id,
            ChatThreadRead.is_archived == True,  # noqa: E712
        )
    )
    archived = set(reads.scalars().all())
    counts = await unread_counts_for_threads(db, [i for i in ids if i not in archived], user_id)
    return sum(counts.values())


async def count_unread_all(
    db: AsyncSession, user_id: str, project_ids: list[str], *, hide_money_projects: frozenset[str] | set[str] = frozenset()
) -> int:
    total = 0
    for pid in project_ids:
        total += await count_unread_project(db, pid, user_id, hide_money=pid in hide_money_projects)
    return total


async def list_threads(db: AsyncSession, project_id: str, *, hide_money: bool = False) -> list[ChatThread]:
    r = await db.execute(
        select(ChatThread).where(ChatThread.project_id == project_id).order_by(ChatThread.updated_at.desc())
    )
    threads = list(r.scalars().all())
    if hide_money:
        from app.services.chat_acl import money_thread_ids

        hidden = await money_thread_ids(db, project_id)
        threads = [t for t in threads if t.id not in hidden]
    return threads


def _desc(value: str | None) -> tuple:
    """Sort key fragment for descending order of ISO timestamps (None last)."""
    if not value:
        return (1, [])
    return (0, [-ord(ch) for ch in value])


def _thread_order_key(x: dict) -> tuple:
    """Pinned threads first (most recently pinned first), then newest activity first."""
    pinned = bool(x.get("is_pinned"))
    return (
        0 if pinned else 1,
        _desc(x.get("pinned_at")) if pinned else (0, []),
        _desc(x.get("updated_at")),
    )


async def list_threads_enriched(db: AsyncSession, project_id: str, user_id: str, *, hide_money: bool = False) -> list[dict]:
    """Thread list with last message and unread via aggregate queries (COM-024).

    Never loads a thread's message history: three queries regardless of thread count.
    """
    threads = await list_threads(db, project_id, hide_money=hide_money)
    ids = [t.id for t in threads]
    lasts = await last_messages_for_threads(db, ids)
    unread = await unread_counts_for_threads(db, ids, user_id)
    states: dict[str, ChatThreadRead] = {}
    if ids:
        rows = await db.execute(
            select(ChatThreadRead)
            .where(ChatThreadRead.thread_id.in_(ids), ChatThreadRead.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        states = {r.thread_id: r for r in rows.scalars().all()}
    out = []
    for t in threads:
        state = states.get(t.id)
        out.append(
            thread_dict(
                t,
                lasts.get(t.id),
                unread=unread.get(t.id, 0),
                is_pinned=bool(state and state.is_pinned),
                is_archived=bool(state and state.is_archived),
                pinned_at=state.pinned_at if state else None,
            )
        )
    out.sort(key=_thread_order_key)
    return out


async def list_inbox(
    db: AsyncSession,
    user_id: str,
    project_ids: list[tuple[str, str]],
    *,
    hide_money_projects: frozenset[str] | set[str] = frozenset(),
) -> list[dict]:
    """project_ids: [(id, name), ...]"""
    inbox = []
    for pid, pname in project_ids:
        for th in await list_threads_enriched(db, pid, user_id, hide_money=pid in hide_money_projects):
            th["project_name"] = pname
            inbox.append(th)
    inbox.sort(key=_thread_order_key)
    return inbox


CHAT_THREAD_CREATE_SCOPE = "chat_thread.create"


async def _load_thread(db: AsyncSession, thread_id: str) -> ChatThread:
    t = await db.get(ChatThread, thread_id)
    if t is None:
        raise RuntimeError("chat_thread_idempotency_ledger_corrupt")
    return t


async def create_thread(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str,
    topic: str | None,
    *,
    client_request_id: str | None = None,
) -> ChatThread:
    """Create exactly one chat thread per client_request_id.

    A lost response after the first commit must replay into the original
    thread, not a duplicate or a title-matched sibling thread — two
    legitimate threads can share a title (#390). Same key with a different
    {title, topic} canonical payload raises IdempotencyConflict instead of
    silently reusing an unrelated thread.
    """
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    clean_title = " ".join((title or "").strip().split())
    if not clean_title:
        raise ValueError("empty_title")

    payload = {"title": clean_title, "topic": topic}
    try:
        replay_id = await replay_entity_id(
            db,
            scope=CHAT_THREAD_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            return await _load_thread(db, replay_id)

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
        await db.flush()
        created, entity_id = await commit_client_write(
            db,
            scope=CHAT_THREAD_CREATE_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=t.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        return await _load_thread(db, entity_id)

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
        storage_key, image_url = await storage_svc.save_image(image_data, folder=f"chat-media/{thread.id}")
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
    recipients: dict[str, User] = {}
    if proj:
        from app.services import notification_recipients as recipients_svc
        target_ids = await recipients_svc.project_recipients(db, proj, recipients_svc.CHAT)
        invited_ids = set(
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
        target_ids.update(invited_ids)
        target_ids.discard(user_id)
        target_ids.discard(None)
        for target_id in target_ids:
            target_user = await db.get(User, target_id)
            if target_user is None or getattr(target_user, "deleted_at", None) is not None:
                continue
            recipients[target_id] = target_user
            target_role = target_user.role.value
            await notif_svc.notify(
                db,
                user_id=target_id,
                project_id=thread.project_id,
                notification_type="chat_message",
                title=f"Новое сообщение: {thread.title}",
                body=text or "Вложение",
                link_path=f"/chat/{thread.id}",
                return_to=f"/({target_role})/(tabs)/chat",
            )
    from app.api.v1.ws import broadcast, broadcast_inbox

    await broadcast(thread.id, {"type": "message", "message": msg_dict(msg)})
    if proj:
        payload = {"type": "inbox", "event": "message", "thread_id": thread.id, "project_id": thread.project_id}
        for uid in recipients:
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


def msg_dict(
    m: ChatMessage,
    read_by_other: bool = False,
    author_names: dict[str, str | None] | None = None,
) -> dict:
    meta = _parse_meta(m.meta_json)
    deleted = bool(meta.get("deleted_at"))
    return {
        "id": m.id,
        "author_id": m.user_id,
        # Display name only (never the phone); None when the profile has no name.
        "author_name": (author_names or {}).get(m.user_id),
        "author_role": m.author_role,
        "message_type": m.message_type.value,
        "text": None if deleted else localize_due_dates(m.text),
        "image_url": None if deleted else m.image_url,
        "deleted": deleted,
        "deleted_at": meta.get("deleted_at"),
        "edited_at": meta.get("edited_at"),
        # COM-010: честный статус подтверждения — кто и когда (None пока не подтверждено).
        "confirmed_by": meta.get("confirmed_by"),
        "confirmed_at": meta.get("confirmed_at"),
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


async def author_name_map(db: AsyncSession, user_ids: set[str]) -> dict[str, str | None]:
    """user id -> display name (full_name only; the phone is never exposed)."""
    ids = [u for u in user_ids if u]
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return {uid: ((name or "").strip() or None) for uid, name in rows.all()}


def _before_cursor(msg: ChatMessage):
    return or_(
        ChatMessage.created_at < msg.created_at,
        and_(ChatMessage.created_at == msg.created_at, ChatMessage.id < msg.id),
    )


def _after_cursor(msg: ChatMessage):
    return or_(
        ChatMessage.created_at > msg.created_at,
        and_(ChatMessage.created_at == msg.created_at, ChatMessage.id > msg.id),
    )


async def page_messages(
    db: AsyncSession,
    thread_id: str,
    *,
    limit: int = 50,
    before_id: str | None = None,
    around_id: str | None = None,
) -> tuple[list[ChatMessage], bool, bool]:
    """History window: (messages ascending, has_more_before, has_more_after).

    Default = the latest ``limit`` messages. ``before_id`` = the ``limit`` messages
    strictly older than that message. ``around_id`` = a window centred on it.
    Raises ``LookupError("message_not_found")`` for a cursor outside the thread.
    """
    limit = max(1, int(limit))
    base = select(ChatMessage).where(ChatMessage.thread_id == thread_id)
    desc = (ChatMessage.created_at.desc(), ChatMessage.id.desc())
    asc = (ChatMessage.created_at.asc(), ChatMessage.id.asc())

    async def _cursor(mid: str) -> ChatMessage:
        row = await db.get(ChatMessage, mid)
        if row is None or row.thread_id != thread_id:
            raise LookupError("message_not_found")
        return row

    if around_id:
        target = await _cursor(around_id)
        half = max(1, limit // 2)
        older = (await db.execute(
            base.where(or_(_before_cursor(target), ChatMessage.id == target.id)).order_by(*desc).limit(half + 2)
        )).scalars().all()
        newer = (await db.execute(
            base.where(_after_cursor(target)).order_by(*asc).limit(half + 1)
        )).scalars().all()
        has_before = len(older) > half + 1
        has_after = len(newer) > half
        window = list(reversed(older[: half + 1])) + list(newer[:half])
        return window, has_before, has_after

    stmt = base
    if before_id:
        stmt = stmt.where(_before_cursor(await _cursor(before_id)))
    rows = (await db.execute(stmt.order_by(*desc).limit(limit + 1))).scalars().all()
    has_before = len(rows) > limit
    return list(reversed(rows[:limit])), has_before, False


async def pinned_messages(db: AsyncSession, thread_id: str) -> list[ChatMessage]:
    rows = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id, ChatMessage.is_pinned == True)  # noqa: E712
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    )
    return list(rows.scalars().all())


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_thread_messages(
    db: AsyncSession, project_id: str, user_id: str, q: str, limit: int = 30, *, hide_money: bool = False
) -> list[dict]:
    """Project-wide text search: newest first, literal match, no system/archived/deleted."""
    needle = (q or "").strip()
    if not needle:
        return []
    archived_threads = select(ChatThreadRead.thread_id).where(
        ChatThreadRead.user_id == user_id, ChatThreadRead.is_archived == True  # noqa: E712
    )
    stmt = (
        select(ChatMessage, ChatThread.title)
        .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
        .where(
            ChatThread.project_id == project_id,
            ChatThread.id.not_in(archived_threads),
            ChatMessage.message_type != ChatMessageType.system,
            ChatMessage.text.ilike(f"%{_escape_like(needle)}%", escape="\\"),
        )
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(max(1, min(int(limit), 100)))
    )
    if hide_money:
        from app.services.chat_acl import _money_thread_condition

        stmt = stmt.where(~_money_thread_condition())
    # Soft-deleted messages carry ``deleted_at`` in meta_json (see msg_dict).
    stmt = stmt.where(or_(ChatMessage.meta_json.is_(None), ~ChatMessage.meta_json.contains('"deleted_at"')))
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": m.id,
            "thread_id": m.thread_id,
            "thread_title": title,
            "author_role": m.author_role,
            "text": m.text,
            "created_at": m.created_at.isoformat(),
        }
        for m, title in rows
    ]


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


CHAT_MESSAGE_REACT_SCOPE = "chat_message.react"


async def toggle_reaction(
    db: AsyncSession,
    message_id: str,
    user_id: str,
    emoji: str,
    *,
    project_id: str | None = None,
    client_request_id: str | None = None,
) -> dict:
    """Toggle a user's reaction, replay-safe per queued client intent (#384).

    The mobile offline queue can replay a lost/ambiguous POST .../react. The
    naive toggle below is idempotent in isolation but NOT replay-safe: a
    replayed request after the first one already committed would flip the
    reaction back off. `client_request_id` gives each user tap a stable
    intent identity (apps/mobile/lib/offlineQueue.ts persists the exact
    serialized body, id included, through restart): the same id + the same
    {message_id, emoji} payload returns the canonical reaction state without
    toggling again, while the same id with a *different* payload — a stale
    request racing a newer, distinct intent — fails closed with
    IdempotencyConflict instead of silently applying the wrong toggle. Two
    genuine taps get two different ids and remain two distinct toggles; no
    network pre-read of desired state is needed. `project_id`/`client_request_id`
    are optional so internal/service callers (seed data, tests) keep the plain
    toggle semantics.
    """
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    payload = {"message_id": message_id, "emoji": emoji}
    use_ledger = bool(client_request_id and project_id)

    if use_ledger:
        replay_id = await replay_entity_id(
            db,
            scope=CHAT_MESSAGE_REACT_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            msg = await db.get(ChatMessage, replay_id)
            return _parse_meta(msg.meta_json).get("reactions", {}) if msg else {}

    # Row lock: reaction writes race other read-modify-write mutators of the
    # same ChatMessage.meta_json (e.g. create_task_from_message's linked_task_id
    # backlink). Without this, one writer's stale read can silently clobber the
    # other's field in the shared JSON blob.
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.id == message_id).with_for_update()
    )
    msg = result.scalar_one_or_none()
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

    if use_ledger:
        created, entity_id = await commit_client_write(
            db,
            scope=CHAT_MESSAGE_REACT_SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=message_id,
        )
        if not created:
            # Lost a race to a concurrent replay of the same intent: our
            # mutation above was rolled back with it. Return the winner's
            # canonical state instead of our now-stale in-memory dict.
            winner = await db.get(ChatMessage, entity_id)
            return _parse_meta(winner.meta_json).get("reactions", {}) if winner else {}
    else:
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


async def list_participants(
    db: AsyncSession,
    thread_id: str,
    viewer: User | None = None,
) -> list[dict]:
    """Real members of the thread: project members plus explicitly invited people.

    Chat access is project-wide for the customer, the assigned contractor and that
    contractor's team, so they are participants of every thread even without a
    ``ChatThreadParticipant`` row; reading only invitations left the list empty for
    them. Invited rows are merged in (deduplicated by user).

    ACL: phone and profile_code are contact data, shown only when ``viewer`` holds
    owner/contractor project authority. A thread-only invitee, a read-only guest or
    an unknown viewer (``None``, fail-closed) sees names and roles only.
    """
    from app.services import team_service

    thread = await db.get(ChatThread, thread_id)
    project = await db.get(Project, thread.project_id) if thread else None
    show_contacts = False
    if viewer is not None and project is not None:
        mode, _ro = await team_service.project_access_mode(db, viewer, project)
        show_contacts = mode in ("owner", "contractor")

    def _contacts(phone: str | None, code: str | None) -> dict:
        return {"phone": phone, "profile_code": code} if show_contacts else {"phone": None, "profile_code": None}

    out: list[dict] = []
    seen: set[str] = set()

    def _add_member(u: User | None, role: str) -> None:
        if u is None or u.id in seen or getattr(u, "deleted_at", None):
            return
        seen.add(u.id)
        out.append({
            "id": f"project:{thread_id}:{u.id}",
            "user_id": u.id,
            **_contacts(u.phone, u.profile_code),
            "full_name": u.full_name,
            "status": "active",
            "role": role,
        })

    if project is not None:
        _add_member(await db.get(User, project.customer_id) if project.customer_id else None, "customer")
        _add_member(await db.get(User, project.contractor_id) if project.contractor_id else None, "contractor")
        if project.contractor_id:
            team_rows = await db.execute(
                select(TeamMember, User)
                .join(Team, Team.id == TeamMember.team_id)
                .join(User, User.id == TeamMember.user_id)
                .where(Team.owner_id == project.contractor_id)
                .order_by(TeamMember.created_at.asc(), TeamMember.id.asc())
            )
            for member, u in team_rows.all():
                _add_member(u, f"team_{member.role}")

    r = await db.execute(
        select(ChatThreadParticipant)
        .where(
            ChatThreadParticipant.thread_id == thread_id,
            ChatThreadParticipant.status.not_in(INACTIVE_PARTICIPANT_STATUSES),
        )
        .order_by(ChatThreadParticipant.created_at.asc(), ChatThreadParticipant.id.asc())
    )
    for p in r.scalars().all():
        if p.user_id and p.user_id in seen:
            continue  # already listed as a project member
        u = await db.get(User, p.user_id) if p.user_id else None
        if p.user_id:
            seen.add(p.user_id)
        out.append({
            "id": p.id,
            "user_id": p.user_id,
            **_contacts(p.phone or (u.phone if u else None), p.profile_code or (u.profile_code if u else None)),
            "full_name": u.full_name if u else None,
            "status": p.status,
            "role": "invited",
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
        if existing.status in INACTIVE_PARTICIPANT_STATUSES:
            # Повторное приглашение — явное решение приглашающего: возвращаем доступ.
            existing.status = "active" if (target is not None or existing.user_id) else "pending"
            existing.invited_by = inviter.id
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
                "return_to": f"/({target.role.value})/(tabs)/chat",
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


async def _require_project_assignee(db: AsyncSession, project_id: str, assignee_id: str) -> None:
    """Исполнитель задачи из чата — действующий участник проекта (не гость/не чужой)."""
    from app.services import team_service

    user = await db.get(User, assignee_id)
    project = await db.get(Project, project_id)
    if user is None or project is None or getattr(user, "deleted_at", None) is not None:
        raise ValueError("assignee_not_in_project")
    mode, read_only = await team_service.project_access_mode(db, user, project)
    if mode == "participant" or (mode in ("owner", "contractor") and not read_only):
        return
    raise ValueError("assignee_not_in_project")


async def _send_service_message(
    db: AsyncSession,
    thread: ChatThread,
    user_id: str,
    role: str,
    text: str | None,
    message_type: str,
    *,
    meta: dict,
    request_id: str | None,
) -> ChatMessage:
    """Server-originated task/payment message through the reliable client path.

    Outbox notifications + archived-thread visibility restore + message-level
    idempotency (a retry after a crash replays the same message). The client
    API cannot create these types (COM-012); only the server does.
    """
    from app.services import chat_message_mutation as mutation

    import hashlib

    # request_id column is String(80): derive a fixed-length stable key.
    digest = hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:32] if request_id else uuid.uuid4().hex
    client_request_id = f"svc:{message_type}:{digest}"
    return await mutation.send_client_message(
        db,
        thread=thread,
        user_id=user_id,
        role=role,
        client_request_id=client_request_id,
        text=text,
        message_type=message_type,
        meta=meta,
    )


async def mark_payment_messages_confirmed(db: AsyncSession, payment_id: str) -> list[ChatMessage]:
    """COM-011: a really-confirmed payment marks its chat invoice message(s).

    Called inside the payment confirmation transaction (no commit here). The
    actor is recorded as ``payment`` because the settlement evidence, not a
    chat tap, confirmed it. Idempotent: already-confirmed rows are skipped.
    """
    rows = (
        await db.execute(
            select(ChatMessage).where(
                ChatMessage.message_type == ChatMessageType.payment,
                ChatMessage.meta_json.like(f'%"{payment_id}"%'),
            ).with_for_update()
        )
    ).scalars().all()
    changed: list[ChatMessage] = []
    for msg in rows:
        meta = _parse_meta(msg.meta_json)
        if str(meta.get("payment_id")) != str(payment_id) or msg.confirmed:
            continue
        msg.confirmed = True
        meta["confirmed_by"] = "payment"
        meta["confirmed_at"] = utc_now().isoformat()
        msg.meta_json = _dump_meta(meta)
        changed.append(msg)
    return changed


async def broadcast_messages_updated(messages: list[ChatMessage]) -> None:
    """Best-effort WS fanout after the payment transaction committed."""
    from app.api.v1.ws import broadcast

    for msg in messages:
        try:
            await broadcast(msg.thread_id, {"type": "message_updated", "message": msg_dict(msg)})
        except Exception:
            pass


TASK_FROM_MESSAGE_SCOPE = "chat.task_from_message"
INVOICE_FROM_CHAT_SCOPE = "chat.invoice"


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
    request_id: str | None = None,
) -> ChatMessage:
    from datetime import date
    from app.services import work_order_service as wo_svc
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    payload = {
        "message_id": message_id,
        "title": title,
        "assignee_id": assignee_id,
        "due_at": due_at,
        "work_type": work_type,
    }
    # The whole "task from chat message" operation (WorkOrder + announcement message +
    # backlink on the original message) replays as one unit keyed by request_id: a lost
    # response can retry this call safely without creating a second WorkOrder/message.
    replay_id = await replay_entity_id(
        db,
        scope=TASK_FROM_MESSAGE_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(ChatMessage, replay_id)
        if existing:
            return existing

    # COM-016: невалидная дата — 422 (ValueError("invalid_due_at")), а не 500.
    due = None
    if due_at:
        try:
            due = date.fromisoformat(due_at.strip()[:10])
        except ValueError as exc:
            raise ValueError("invalid_due_at") from exc
    # COM-015: исполнитель обязан быть участником проекта — проверка до любой записи.
    if assignee_id:
        await _require_project_assignee(db, thread.project_id, assignee_id)
    # create_work_order is itself idempotent on request_id, so a crash between the
    # WorkOrder commit below and the ledger write further down still cannot duplicate it.
    wo = await wo_svc.create_work_order(
        db,
        project_id=thread.project_id,
        user_id=user_id,
        title=title,
        work_type=work_type,
        planned_start=due,
        planned_end=due,
        publish=True,
        request_id=request_id,
    )
    if assignee_id and wo.assignee_id != assignee_id:
        wo.assignee_id = assignee_id
        await db.commit()

    text = f"📋 Задача: {title}" + (f" · до {_ru_date(due_at)}" if due_at else "")
    meta = {"work_order_id": wo.id, "assignee_id": assignee_id, "due_at": due_at}
    # COM-034: тот же надёжный путь, что и обычные сообщения (outbox, идемпотентность).
    msg = await _send_service_message(
        db, thread, user_id, role, text, "task", meta=meta, request_id=request_id,
    )
    # Row lock: this backlink write races toggle_reaction's read-modify-write of
    # the same ChatMessage.meta_json (#384) — without it, whichever writer reads
    # last wins and silently drops the other's field from the shared JSON blob.
    orig_result = await db.execute(
        select(ChatMessage).where(ChatMessage.id == message_id).with_for_update()
    )
    orig = orig_result.scalar_one_or_none()
    if orig:
        om = _parse_meta(orig.meta_json)
        om["linked_task_id"] = wo.id
        orig.meta_json = _dump_meta(om)
        await db.commit()

    await commit_client_write(
        db,
        scope=TASK_FROM_MESSAGE_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
        entity_id=msg.id,
    )
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
    request_id: str | None = None,
) -> ChatMessage:
    from app.services import payment_service as pay_svc
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    payload = {"title": title, "amount": round(float(amount), 2), "payment_type": payment_type}
    # Same request_id + same fields -> the original Payment/message are returned, never
    # duplicated. See create_task_from_message above for the equivalent WorkOrder flow.
    replay_id = await replay_entity_id(
        db,
        scope=INVOICE_FROM_CHAT_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(ChatMessage, replay_id)
        if existing:
            return existing

    # create_payment is itself idempotent on request_id, guarding against a crash
    # between the Payment commit and the ledger write further down.
    pay = await pay_svc.create_payment(
        db,
        thread.project_id,
        user_id,
        title,
        amount,
        payment_type,
        request_id=request_id,
        scope="chat.invoice.payment",
    )
    from app.core.money_format import format_rub

    text = f"💳 Счёт: {title} · {format_rub(amount)}"
    meta = {"payment_id": pay.id, "amount": amount}
    msg = await _send_service_message(
        db, thread, user_id, role, text, "payment", meta=meta, request_id=request_id,
    )

    await commit_client_write(
        db,
        scope=INVOICE_FROM_CHAT_SCOPE,
        project_id=thread.project_id,
        user_id=user_id,
        request_id=request_id,
        payload=payload,
        entity_id=msg.id,
    )
    return msg

# --- COM-006: thread lifecycle (rename / archive for everyone / membership) ---

class ThreadError(ValueError):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


def can_manage_thread(thread: ChatThread, project: Project, user: User) -> bool:
    """Only the thread creator or the project customer manage the thread itself."""
    return user.id == thread.created_by or user.id == project.customer_id


async def rename_thread(db: AsyncSession, thread: ChatThread, title: str) -> ChatThread:
    clean = " ".join((title or "").strip().split())
    if not clean:
        raise ThreadError("empty_title", 422)
    if clean == thread.title:
        return thread  # idempotent replay
    thread.title = clean
    thread.updated_at = utc_now()
    await db.commit()
    await db.refresh(thread)
    await _broadcast_thread_event(thread.id, {"type": "thread_updated", "thread_id": thread.id, "title": thread.title})
    return thread


async def set_thread_archived_for_all(db: AsyncSession, thread: ChatThread, archived: bool) -> int:
    """Archive/unarchive the thread in every member's list. Idempotent."""
    members = {p["user_id"] for p in await list_participants(db, thread.id, None) if p.get("user_id")}
    members.add(thread.created_by)
    changed = 0
    for uid in members:
        row = await _get_or_create_read(db, thread.id, uid)
        if bool(row.is_archived) != archived:
            row.is_archived = archived
            row.updated_at = utc_now()
            changed += 1
    await db.commit()
    if changed:
        await _broadcast_thread_event(
            thread.id, {"type": "thread_updated", "thread_id": thread.id, "archived": archived}
        )
    return changed


async def _broadcast_thread_event(thread_id: str, payload: dict) -> None:
    from app.api.v1.ws import broadcast

    try:
        await broadcast(thread_id, payload)
    except Exception:
        pass


async def _deactivate_participant(db: AsyncSession, row: ChatThreadParticipant, status: str) -> bool:
    """Move an invited participant to ``left``/``removed``. Returns True if it changed."""
    if row.status in INACTIVE_PARTICIPANT_STATUSES:
        return False
    row.status = status
    await db.commit()
    await _broadcast_thread_event(
        row.thread_id, {"type": "participant_removed", "thread_id": row.thread_id, "user_id": row.user_id, "status": status}
    )
    if row.user_id:
        from app.api.v1.ws import recheck_user_access

        try:
            await recheck_user_access(row.thread_id, row.user_id)
        except Exception:
            pass
    return True


async def remove_participant(db: AsyncSession, thread: ChatThread, participant_id: str) -> ChatThreadParticipant:
    row = await db.get(ChatThreadParticipant, participant_id)
    if row is None or row.thread_id != thread.id:
        raise ThreadError("participant_not_found", 404)
    await _deactivate_participant(db, row, "removed")
    return row


async def leave_thread(db: AsyncSession, thread: ChatThread, user: User) -> ChatThreadParticipant:
    """A thread-only invitee leaves. Repeating the call is a no-op success."""
    rows = list(
        (
            await db.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.thread_id == thread.id,
                    ChatThreadParticipant.user_id == user.id,
                )
            )
        ).scalars().all()
    )
    if not rows:
        raise ThreadError("not_a_thread_participant", 403)
    for row in rows:
        await _deactivate_participant(db, row, "left" if row.status != "removed" else "removed")
    return rows[0]
