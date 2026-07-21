"""Inbox чатов — все проекты пользователя (атомарный unread snapshot)."""
from __future__ import annotations

import time
from threading import Lock

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, User
from app.services import chat_service as chat_svc

router = APIRouter(prefix="/chats", tags=["chats-inbox"])

# Scope: messages; archived excluded; muted/closed N/A
UNREAD_SCOPE = {
    "include_archived": False,
    "include_muted": False,
    "unit": "messages",
}

# Epoch microseconds remain below Number.MAX_SAFE_INTEGER for centuries.
# The process-local sequence prevents equal/reversed revisions when multiple
# snapshots are built inside the same clock tick or the wall clock moves back.
_revision_lock = Lock()
_last_revision = 0


def _next_revision() -> int:
    """Return a strictly increasing, JavaScript-safe snapshot revision."""
    global _last_revision

    now_us = time.time_ns() // 1_000
    with _revision_lock:
        _last_revision = max(now_us, _last_revision + 1)
        return _last_revision


async def _user_projects(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    r = await db.execute(
        select(Project).where((Project.customer_id == user.id) | (Project.contractor_id == user.id))
    )
    return [(p.id, p.name) for p in r.scalars().all()]


def _build_snapshot(threads: list[dict]) -> dict:
    """Атомарный snapshot: total = sum(unread) по неархивным тредам."""
    total = 0
    for th in threads:
        if th.get("is_archived"):
            continue
        total += max(0, int(th.get("unread_count") or 0))
    return {
        "revision": _next_revision(),
        "total_unread_messages": total,
        "threads": threads,
        "scope": UNREAD_SCOPE,
    }


@router.get("/inbox")
async def inbox(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Атомарный snapshot inbox + unread.

    Клиенты должны применять ответ целиком. Поле `count` в unread-total deprecated.
    """
    projects = await _user_projects(db, user)
    threads = await chat_svc.list_inbox(db, user.id, projects)
    return _build_snapshot(threads)


@router.get("/unread-total")
async def unread_total(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Совместимость: тот же total, что в snapshot (без независимого расчёта).

    Для консистентности пересчитываем через list_inbox → sum active.
    """
    projects = await _user_projects(db, user)
    threads = await chat_svc.list_inbox(db, user.id, projects)
    snap = _build_snapshot(threads)
    return {
        "count": snap["total_unread_messages"],  # deprecated
        "revision": snap["revision"],
        "total_unread_messages": snap["total_unread_messages"],
        "scope": UNREAD_SCOPE,
    }
