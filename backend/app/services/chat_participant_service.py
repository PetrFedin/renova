"""Thread-scoped chat participant lifecycle and inbox access.

A chat invitation must never imply access to the whole renovation project.
This module therefore owns the narrow capability boundary for active invited
participants: adopt pending phone invitations after OTP login, authorize only
the invited thread, and expose only those exact threads in the global inbox.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.phone import normalize_phone
from app.models.entities import ChatThread, ChatThreadParticipant, Project, User


async def activate_pending_phone_invitations(
    db: AsyncSession,
    user: User,
) -> int:
    """Attach durable pending phone invitations to a verified/login user.

    The caller owns the surrounding transaction. Repeated login is idempotent:
    already-active rows are not rewritten and the same invitation never creates
    a second participant row.
    """
    phone = normalize_phone(user.phone)
    rows = list(
        (
            await db.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.phone == phone,
                    ChatThreadParticipant.user_id.is_(None),
                    ChatThreadParticipant.status == "pending",
                )
            )
        ).scalars().all()
    )
    for row in rows:
        row.user_id = user.id
        row.status = "active"
    if rows:
        await db.flush()
    return len(rows)


async def is_active_thread_participant(
    db: AsyncSession,
    *,
    thread_id: str,
    user_id: str,
) -> bool:
    row = (
        await db.execute(
            select(ChatThreadParticipant.id)
            .where(
                ChatThreadParticipant.thread_id == thread_id,
                ChatThreadParticipant.user_id == user_id,
                ChatThreadParticipant.status == "active",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


async def participant_inbox(
    db: AsyncSession,
    *,
    user_id: str,
    exclude_project_ids: set[str],
) -> list[dict]:
    """Return exact invited threads without widening access to sibling chats."""
    from app.services import chat_service as chat_svc

    query = (
        select(ChatThread, Project)
        .join(
            ChatThreadParticipant,
            ChatThreadParticipant.thread_id == ChatThread.id,
        )
        .join(Project, Project.id == ChatThread.project_id)
        .where(
            ChatThreadParticipant.user_id == user_id,
            ChatThreadParticipant.status == "active",
            Project.trashed_at.is_(None),
        )
        .order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
    )
    if exclude_project_ids:
        query = query.where(ChatThread.project_id.not_in(exclude_project_ids))

    seen: set[str] = set()
    out: list[dict] = []
    for thread, project in (await db.execute(query)).all():
        if thread.id in seen:
            continue
        seen.add(thread.id)
        full = await chat_svc.get_thread(db, thread.id)
        last = (
            sorted(full.messages, key=lambda message: (message.created_at, message.id))[-1]
            if full and full.messages
            else None
        )
        state = await chat_svc.get_thread_read_state(db, thread.id, user_id)
        unread = await chat_svc.count_unread_in_thread(db, thread.id, user_id)
        item = chat_svc.thread_dict(
            thread,
            last,
            unread=unread,
            is_pinned=bool(state and state.is_pinned),
            is_archived=bool(state and state.is_archived),
            pinned_at=state.pinned_at if state else None,
        )
        item["project_name"] = project.name
        out.append(item)
    return out


async def participant_unread_total(
    db: AsyncSession,
    *,
    user_id: str,
    exclude_project_ids: set[str],
) -> int:
    """Count only exact invited threads; never all chats in their projects."""
    items = await participant_inbox(
        db,
        user_id=user_id,
        exclude_project_ids=exclude_project_ids,
    )
    return sum(
        int(item.get("unread_count") or 0)
        for item in items
        if not item.get("is_archived")
    )
