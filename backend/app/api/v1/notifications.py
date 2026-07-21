"""In-app уведомления."""
from app.core.timeutil import utc_now
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User
from app.services import notification_service as notif_svc

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/unread-count")
async def unread_count(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await notif_svc.list_for_user(db, user.id, unread_only=True)
    return {"count": len(items)}

@router.get("")
async def my_notifications(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await notif_svc.list_for_user(db, user.id)
    return [notif_svc.notif_dict(n) for n in items]


@router.post("/mark-all-read")
async def mark_all(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await notif_svc.list_for_user(db, user.id, unread_only=True)
    for n in items:
        n.read = True
    await db.commit()
    return {"ok": True, "count": len(items)}

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

@router.get("/reaction-digest")
async def reaction_digest(push: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import timedelta, datetime
    from sqlalchemy import select
    from app.models.entities import AppNotification
    since = utc_now() - timedelta(hours=24)
    r = await db.execute(select(AppNotification).where(AppNotification.user_id == user.id, AppNotification.notification_type == 'reaction', AppNotification.created_at >= since))
    items = r.scalars().all()
    if push and items:
        await notif_svc.notify(db, user_id=user.id, project_id=items[0].project_id, notification_type='reaction', title=f'Сводка реакций ({len(items)})', body='За 24ч', link_path='/profile', return_to='/(customer)/(tabs)/profile')
    return {"count": len(items), "items": [notif_svc.notif_dict(n) for n in items], "digest_push": bool(items)}

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
async def waste_reminders(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Manual tick — same logic as automation_reminders_worker.scan_waste_reminders."""
    from app.services.automation_reminders_worker import scan_waste_reminders

    sent = await scan_waste_reminders(db)
    await db.commit()
    return {"sent": sent}
