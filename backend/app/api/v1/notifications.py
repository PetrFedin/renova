"""In-app уведомления."""
from app.core.timeutil import utc_now
from fastapi import APIRouter, HTTPException, Depends, Query
from app.api.admin_access import require_admin_user
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User
from app.services import notification_service as notif_svc

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/unread-count")
async def unread_count(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return {"count": await notif_svc.count_unread(db, user.id)}


@router.get("")
async def my_notifications(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await notif_svc.list_for_user(db, user.id, limit=limit, offset=offset)
    return [notif_svc.notif_dict(n) for n in items]


@router.post("/mark-all-read")
async def mark_all(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return {"ok": True, "count": await notif_svc.mark_all_read(db, user.id)}

@router.post("/{notification_id}/snooze")
async def snooze_notif(notification_id: str, hours: int = 24, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ok = await notif_svc.snooze(db, notification_id, user.id, max(1, min(168, hours)))
    if not ok:
        raise HTTPException(404)
    return {"ok": True}

from datetime import datetime
from pydantic import BaseModel

class SnoozeUntilIn(BaseModel):
    until_iso: str

@router.post("/{notification_id}/snooze-until")
async def snooze_until_notif(notification_id: str, body: SnoozeUntilIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        until = datetime.fromisoformat(body.until_iso.replace('Z', ''))
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(400, 'bad date')
    ok = await notif_svc.snooze_until(db, notification_id, user.id, until)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(404)
    return {"ok": True}

_REACTION_DIGEST_TITLE = "Сводка реакций"


@router.get("/reaction-digest")
async def reaction_digest(push: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import timedelta
    from sqlalchemy import select
    from app.models.entities import AppNotification, NotificationType
    since = utc_now() - timedelta(hours=24)
    r = await db.execute(select(AppNotification).where(AppNotification.user_id == user.id, AppNotification.notification_type == NotificationType.reaction, AppNotification.created_at >= since))
    items = r.scalars().all()
    pushed = False
    if push and items:
        # COM-023: the digest is stored as type "other" so it never counts as a
        # reaction itself, and at most one digest is created per 24h window.
        existing = await db.execute(
            select(AppNotification.id).where(
                AppNotification.user_id == user.id,
                AppNotification.notification_type == NotificationType.other,
                AppNotification.title.like(f"{_REACTION_DIGEST_TITLE}%"),
                AppNotification.created_at >= since,
            ).limit(1)
        )
        if existing.first() is None:
            await notif_svc.notify(db, user_id=user.id, project_id=items[0].project_id, notification_type='other', title=f'{_REACTION_DIGEST_TITLE} ({len(items)})', body='За 24ч', link_path='/profile', return_to='/(customer)/(tabs)/profile')
            pushed = True
    return {"count": len(items), "items": [notif_svc.notif_dict(n) for n in items], "digest_push": pushed}

@router.post("/{notification_id}/read")
async def read_notification(notification_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ok = await notif_svc.mark_read(db, notification_id, user.id)
    return {"ok": ok}

@router.get("/approval-digest")
async def approval_digest(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import AppNotification
    from datetime import datetime, timedelta
    since = utc_now() - timedelta(days=7)
    from app.models.entities import NotificationType
    r = await db.execute(select(AppNotification).where(
        AppNotification.user_id == user.id,
        AppNotification.notification_type.in_([NotificationType.change_order, NotificationType.payment_pending, NotificationType.room_change]),
        AppNotification.read.is_(False),
        AppNotification.created_at >= since,
    ))
    items = r.scalars().all()
    return {"count": len(items), "items": [notif_svc.notif_dict(n) for n in items[:20]]}

@router.post("/waste-reminders/check")
async def waste_reminders(_admin: User = Depends(require_admin_user), db: AsyncSession = Depends(get_db)):
    """Manual tick (admin/ops only, COM-022) — same logic as automation_reminders_worker.scan_waste_reminders."""
    from app.services.automation_reminders_worker import scan_waste_reminders

    sent = await scan_waste_reminders(db)
    await db.commit()
    return {"sent": sent}
