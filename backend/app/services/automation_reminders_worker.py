"""Periodic automation tick — project reminders + waste pickup + health metrics."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, WasteOrder, WasteOrderStatus
from app.services import notification_service as notif_svc
from app.services.automation_engine import scan_project_reminders

logger = logging.getLogger(__name__)

# P4.2a — in-process health (ops: GET /api/v1/automation/worker)
_METRICS: dict[str, Any] = {
    "last_tick_at": None,
    "last_ok_at": None,
    "last_error": None,
    "consecutive_failures": 0,
    "ticks_total": 0,
    "ticks_ok": 0,
    "last_result": None,
}


def automation_worker_metrics() -> dict[str, Any]:
    return dict(_METRICS)


def _record_ok(result: dict) -> None:
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    _METRICS["last_tick_at"] = now
    _METRICS["last_ok_at"] = now
    _METRICS["last_error"] = None
    _METRICS["consecutive_failures"] = 0
    _METRICS["ticks_total"] = int(_METRICS["ticks_total"]) + 1
    _METRICS["ticks_ok"] = int(_METRICS["ticks_ok"]) + 1
    _METRICS["last_result"] = result


def _record_fail(exc: BaseException) -> None:
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    _METRICS["last_tick_at"] = now
    _METRICS["last_error"] = f"{type(exc).__name__}: {exc}"[:500]
    _METRICS["consecutive_failures"] = int(_METRICS["consecutive_failures"]) + 1
    _METRICS["ticks_total"] = int(_METRICS["ticks_total"]) + 1
    fails = int(_METRICS["consecutive_failures"])
    if fails >= 3:
        logger.error(
            "ALERT automation_reminders: %s consecutive failures — last=%s",
            fails,
            _METRICS["last_error"],
        )


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
                link_path="/(customer)/(tabs)/calendar",
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
            _record_ok(result)
            if result["project_actions"] or result["waste_sent"]:
                logger.info("automation tick: %s", result)
        except Exception as exc:
            _record_fail(exc)
            logger.exception("automation reminders tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(60.0, interval_sec))
            break
        except asyncio.TimeoutError:
            continue
    logger.info("automation reminders worker stopped")
