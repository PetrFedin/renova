"""In-app уведомления + push с returnTo для навигации назад."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AppNotification, NotificationType
from app.models.outbox_runtime import SideEffectDelivery
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


def _stored_link(link_path: str | None, return_to: str | None) -> str | None:
    if not link_path or not return_to:
        return link_path
    separator = "&" if "?" in link_path else "?"
    return f"{link_path}{separator}returnTo={return_to}"


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
    notification = AppNotification(
        user_id=user_id,
        project_id=project_id,
        notification_type=resolve_notification_type(notification_type),
        title=title,
        body=body,
        link_path=_stored_link(link_path, return_to),
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    await send_push(
        db,
        user_id,
        title,
        body,
        {"link_path": link_path, "returnTo": return_to or "/"},
    )
    return notification


async def notify_from_outbox(
    db: AsyncSession,
    *,
    outbox_id: str,
    user_id: str,
    project_id: str | None,
    notification_type: str,
    title: str,
    body: str,
    link_path: str | None = None,
    return_to: str | None = None,
) -> AppNotification:
    """Create one in-app notification and retry only the unfinished push step."""
    delivery = (
        await db.execute(
            select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == outbox_id)
        )
    ).scalar_one_or_none()

    if delivery:
        notification = await db.get(AppNotification, delivery.entity_id)
        if not notification:
            raise RuntimeError("outbox_notification_target_missing")
    else:
        notification = AppNotification(
            user_id=user_id,
            project_id=project_id,
            notification_type=resolve_notification_type(notification_type),
            title=title,
            body=body,
            link_path=_stored_link(link_path, return_to),
        )
        db.add(notification)
        await db.flush()
        delivery = SideEffectDelivery(
            outbox_id=outbox_id,
            effect_type="notification",
            entity_id=notification.id,
        )
        db.add(delivery)
        await db.commit()
        await db.refresh(notification)

    if delivery.delivered_at is None:
        accepted = await send_push(
            db,
            user_id,
            title,
            body,
            {
                "link_path": link_path,
                "returnTo": return_to or "/",
                "outbox_id": outbox_id,
            },
        )
        if not accepted:
            raise RuntimeError("push_delivery_failed")
        delivery.delivered_at = utc_now()
        await db.commit()

    return notification


async def list_for_user(db: AsyncSession, user_id: str, unread_only: bool = False) -> list[AppNotification]:
    query = select(AppNotification).where(AppNotification.user_id == user_id)
    query = query.where((AppNotification.snoozed_until.is_(None)) | (AppNotification.snoozed_until < utc_now()))
    if unread_only:
        query = query.where(AppNotification.read.is_(False))
    result = await db.execute(query.order_by(AppNotification.created_at.desc()).limit(50))
    return list(result.scalars().all())


async def mark_read(db: AsyncSession, notification_id: str, user_id: str) -> bool:
    result = await db.execute(
        select(AppNotification).where(
            AppNotification.id == notification_id,
            AppNotification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        return False
    notification.read = True
    await db.commit()
    return True


async def snooze_until(db: AsyncSession, notification_id: str, user_id: str, until: datetime) -> bool:
    result = await db.execute(
        select(AppNotification).where(
            AppNotification.id == notification_id,
            AppNotification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        return False
    notification.snoozed_until = until
    await db.commit()
    return True


async def snooze(db: AsyncSession, notification_id: str, user_id: str, hours: int = 24) -> bool:
    result = await db.execute(
        select(AppNotification).where(
            AppNotification.id == notification_id,
            AppNotification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        return False
    notification.snoozed_until = utc_now() + timedelta(hours=hours)
    await db.commit()
    return True


def notif_dict(notification: AppNotification) -> dict:
    return {
        "id": notification.id,
        "project_id": notification.project_id,
        "notification_type": notification.notification_type.value,
        "title": notification.title,
        "body": notification.body,
        "link_path": notification.link_path,
        "return_to": (notification.link_path or "").split("returnTo=")[-1].split("&")[0]
        if "returnTo=" in (notification.link_path or "")
        else None,
        "read": notification.read,
        "created_at": notification.created_at.isoformat(),
    }
