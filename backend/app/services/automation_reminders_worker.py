"""Periodic automation tick — project reminders + waste pickup."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, WasteOrder, WasteOrderStatus
from app.services import notification_service as notif_svc
from app.services.automation_engine import scan_project_reminders

logger = logging.getLogger(__name__)


async def scan_waste_reminders(db: AsyncSession, *, on_date: date | None = None) -> int:
    """Notify customers about waste pickup scheduled for tomorrow."""
    tomorrow = (on_date or date.today()) + timedelta(days=1)
    r = await db.execute(
        select(WasteOrder).where(
            WasteOrder.scheduled_date == tomorrow,
            WasteOrder.status == WasteOrderStatus.scheduled,
        )
    )
    sent = 0
    for w in r.scalars().all():
        p = await db.get(Project, w.project_id)
        if p and p.customer_id:
            await notif_svc.notify(
                db,
                user_id=p.customer_id,
                project_id=w.project_id,
                notification_type="waste_reminder",
                title="Завтра вывоз мусора",
                body=f"{w.volume_m3} м³",
                link_path="/(customer)/(tabs)/estimate",
            )
            sent += 1
    return sent


async def run_automation_reminder_tick(*, on_date: date | None = None) -> dict:
    """Single tick: scan all active projects + waste reminders."""
    project_actions: list[str] = []
    waste_sent = 0
    from app.db import session as db_session

    async with db_session.SessionLocal() as db:
        projects = list((await db.execute(select(Project))).scalars().all())
        for project in projects:
            await db.refresh(project, ["stages"])
            project_actions.extend(await scan_project_reminders(db, project))
        waste_sent = await scan_waste_reminders(db, on_date=on_date)
        await db.commit()
    return {"project_actions": len(project_actions), "waste_sent": waste_sent}


async def automation_reminders_loop(stop: asyncio.Event, *, interval_sec: float) -> None:
    """Background loop — started from FastAPI lifespan."""
    logger.info("automation reminders worker started (interval=%ss)", interval_sec)
    while not stop.is_set():
        try:
            result = await run_automation_reminder_tick()
            if result["project_actions"] or result["waste_sent"]:
                logger.info("automation tick: %s", result)
        except Exception:
            logger.exception("automation reminders tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(60.0, interval_sec))
            break
        except asyncio.TimeoutError:
            continue
    logger.info("automation reminders worker stopped")
