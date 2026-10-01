"""In-app уведомления + push с returnTo для навигации назад."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime, timedelta
from urllib.parse import quote, unquote

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AppNotification, NotificationType
from app.models.outbox_runtime import SideEffectDelivery
from app.services.push_service import send_push, stable_push_delivery_id

_TYPE_ALIASES: dict[str, str] = {
    "material": "materials",
    "budget": "budget_alert",
    "stage_start": "stage_started",
    "schedule_review": "approval",
    "schedule_confirmed": "approval",
    "schedule_rejected": "issue",
}


def resolve_notification_type(raw: str) -> NotificationType:
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
    # return_to may itself carry a query ("/x?tab=y"); unencoded it would add a
    # second "?" and leak its "&"/"=" into the outer query, so the client (which
    # splits on the first "?") would mis-parse the link.
    return f"{link_path}{separator}returnTo={quote(return_to, safe='/()')}"


async def notify(
async def _nudge_inbox(user_id: str) -> None:
    """Best-effort WS frame so an open app refreshes its notification badge at once."""
    try:
        from app.api.v1.ws import broadcast_inbox

        await broadcast_inbox(user_id, {"type": "notification"})
    except Exception:
        # The badge also refreshes on the regular inbox sync; never fail a notify.
        pass


    db: AsyncSession,
    *,
    user_id: str,
    project_id: str | None,
    notification_type: str,
    title: str,
    body: str,
    link_path: str | None = None,
    return_to: str | None = None,
) -> AppNotification | None:
    from app.services.client_write_side_effects import (
        payment_transition_side_effects_suppressed,
        take_client_write_side_effect,
    )

    if (
        payment_transition_side_effects_suppressed()
        and notification_type in {"payment_pending", "payment_confirmed"}
    ):
        return None

    outbox_id = take_client_write_side_effect("notification", match_key=user_id)
    if outbox_id:
        return await notify_from_outbox(
            db,
            outbox_id=outbox_id,
            user_id=user_id,
            project_id=project_id,
            notification_type=notification_type,
            title=title,
            body=body,
            link_path=link_path,
            return_to=return_to,
        )

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
    delivery_id = stable_push_delivery_id(f"notification:{notification.id}")
    await send_push(
        db,
        user_id,
        title,
        body,
        {"link_path": link_path, "returnTo": return_to or "/"},
        delivery_id=delivery_id,
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
        delivery_id = stable_push_delivery_id(f"outbox:{outbox_id}")
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
            delivery_id=delivery_id,
        )
        if not accepted:
            raise RuntimeError("push_delivery_failed")
        delivery.delivered_at = utc_now()
        await db.commit()

    return notification


def _visible_filter(user_id: str):
    """Snoozed notifications are hidden until their snooze expires."""
    return (
        AppNotification.user_id == user_id,
        (AppNotification.snoozed_until.is_(None)) | (AppNotification.snoozed_until < utc_now()),
    )


async def list_for_user(
    db: AsyncSession,
    user_id: str,
    unread_only: bool = False,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[AppNotification]:
    """One page of visible notifications, newest first (COM-009: paginated)."""
    query = select(AppNotification).where(*_visible_filter(user_id))
    if unread_only:
        query = query.where(AppNotification.read.is_(False))
    query = query.order_by(AppNotification.created_at.desc(), AppNotification.id.desc())
    result = await db.execute(query.limit(max(1, min(limit, 200))).offset(max(0, offset)))
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
async def count_unread(db: AsyncSession, user_id: str) -> int:
    """Real COUNT of every visible unread notification (COM-009: no 50 cap)."""
    result = await db.execute(
        select(func.count())
        .select_from(AppNotification)
        .where(*_visible_filter(user_id), AppNotification.read.is_(False))
    )
    return int(result.scalar_one() or 0)


async def mark_all_read(db: AsyncSession, user_id: str) -> int:
    """Mark every unread notification of the user as read; returns how many changed."""
    result = await db.execute(
        update(AppNotification)
        .where(AppNotification.user_id == user_id, AppNotification.read.is_(False))
        .values(read=True)
    )
    await db.commit()
    return int(result.rowcount or 0)


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
        "return_to": _return_to_of(notification.link_path),
        "read": notification.read,
        "created_at": notification.created_at.isoformat(),
    }
def _return_to_of(link_path: str | None) -> str | None:
    """Decoded returnTo carried by a stored link (stored percent-encoded, see _stored_link)."""
    if not link_path or "returnTo=" not in link_path:
        return None
    return unquote(link_path.split("returnTo=")[-1].split("&")[0])


