"""In-app уведомления + push с returnTo для навигации назад."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AppNotification, NotificationType
from app.services.push_service import send_push

# Исторические строки из callers → канон enum (CI/prod не падают на опечатках/алиасах).
_TYPE_ALIASES: dict[str, str] = {
    "material": "materials",
    "budget": "budget_alert",
    "stage_start": "stage_started",
}


def resolve_notification_type(raw: str) -> NotificationType:
    """Маппинг строки caller → NotificationType; неизвестное → other."""
    key = (raw or "").strip()
    key = _TYPE_ALIASES.get(key, key)
    try:
        return NotificationType(key)
    except ValueError:
        return NotificationType.other


async def notify(
    db: AsyncSession,
    *,
    user_id: str,
    project_id: str | None,
    notification_type: str,
    title: str,
    body: str,
    link_path: str | None = None,
    return_to: str | None = None,
) -> AppNotification:
    stored_link = link_path
    if link_path and return_to:
        sep = "&" if "?" in link_path else "?"
        stored_link = f"{link_path}{sep}returnTo={return_to}"
    n = AppNotification(
        user_id=user_id,
        project_id=project_id,
        notification_type=resolve_notification_type(notification_type),
        title=title,
        body=body,
        link_path=stored_link,
    )
    db.add(n)
    await db.commit()
    await db.refresh(n)
    await send_push(db, user_id, title, body, {"link_path": link_path, "returnTo": return_to or "/"})
    return n


async def list_for_user(db: AsyncSession, user_id: str, unread_only: bool = False) -> list[AppNotification]:
    q = select(AppNotification).where(AppNotification.user_id == user_id)
    q = q.where((AppNotification.snoozed_until.is_(None)) | (AppNotification.snoozed_until < datetime.utcnow()))
    if unread_only:
        q = q.where(AppNotification.read.is_(False))
    r = await db.execute(q.order_by(AppNotification.created_at.desc()).limit(50))
    return list(r.scalars().all())


async def mark_read(db: AsyncSession, notification_id: str, user_id: str) -> bool:
    r = await db.execute(select(AppNotification).where(AppNotification.id == notification_id, AppNotification.user_id == user_id))
    n = r.scalar_one_or_none()
    if not n:
        return False
    n.read = True
    await db.commit()
    return True


async def snooze_until(db: AsyncSession, notification_id: str, user_id: str, until: datetime) -> bool:
    r = await db.execute(select(AppNotification).where(AppNotification.id == notification_id, AppNotification.user_id == user_id))
    n = r.scalar_one_or_none()
    if not n:
        return False
    n.snoozed_until = until
    await db.commit()
    return True


async def snooze(db: AsyncSession, notification_id: str, user_id: str, hours: int = 24) -> bool:
    r = await db.execute(select(AppNotification).where(AppNotification.id == notification_id, AppNotification.user_id == user_id))
    n = r.scalar_one_or_none()
    if not n:
        return False
    n.snoozed_until = datetime.utcnow() + timedelta(hours=hours)
    await db.commit()
    return True


def notif_dict(n: AppNotification) -> dict:
    return {
        "id": n.id,
        "project_id": n.project_id,
        "notification_type": n.notification_type.value,
        "title": n.title,
        "body": n.body,
        "link_path": n.link_path,
        "return_to": (n.link_path or "").split("returnTo=")[-1].split("&")[0] if "returnTo=" in (n.link_path or "") else None,
        "read": n.read,
        "created_at": n.created_at.isoformat(),
    }
