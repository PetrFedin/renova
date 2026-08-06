"""Periodic automation tick — project reminders + waste pickup + health metrics."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, WasteOrder, WasteOrderStatus
from app.services.automation_engine import scan_project_reminders
from app.services.automation_reminder_outbox import enqueue_notification_once
from app.services.outbox_service import dispatch_pending

logger = logging.getLogger(__name__)

_OUTBOX_DEGRADED_AGE_SECONDS = 300
_METRICS: dict[str, Any] = {
    "last_tick_at": None,
    "last_ok_at": None,
    "last_error": None,
    "consecutive_failures": 0,
    "ticks_total": 0,
    "ticks_ok": 0,
    "last_result": None,
    "ops_alert_last_status": None,
    "ops_alert_last_at": None,
    "ops_alert_last_error": None,
    "outbox_status": "unknown",
    "outbox_health": None,
    "outbox_alerted_status": None,
    "outbox_alert_count": 0,
    "outbox_alert_last_action": None,
    "outbox_alert_last_status": None,
    "outbox_alert_last_at": None,
    "outbox_alert_last_error": None,
}


def automation_worker_metrics() -> dict[str, Any]:
    snapshot = dict(_METRICS)
    health = snapshot.get("outbox_health")
    snapshot["outbox_health"] = dict(health) if isinstance(health, dict) else health
    return snapshot


_ops_alert_sent_for_streak = False
_outbox_alerted_status: str | None = None


def _record_ops_alert(status: str, error: str | None = None) -> None:
    _METRICS["ops_alert_last_status"] = status
    _METRICS["ops_alert_last_at"] = utc_now().isoformat(timespec="seconds") + "Z"
    _METRICS["ops_alert_last_error"] = error[:500] if error else None


def _bounded_outbox_health(snapshot: dict[str, object]) -> dict[str, int | str | None]:
    pending = max(0, int(snapshot.get("pending") or 0))
    retryable = max(0, int(snapshot.get("retryable") or 0))
    poisoned = max(0, int(snapshot.get("poisoned") or 0))
    active_leases = max(0, int(snapshot.get("active_leases") or 0))
    stale_leases = max(0, int(snapshot.get("stale_leases") or 0))
    age_value = snapshot.get("oldest_pending_age_seconds")
    oldest_age = max(0, int(age_value)) if age_value is not None else None
    max_attempts = max(1, int(snapshot.get("max_attempts") or 1))

    status = "healthy"
    if poisoned > 0:
        status = "critical"
    elif stale_leases > 0 or (
        pending > 0
        and oldest_age is not None
        and oldest_age >= _OUTBOX_DEGRADED_AGE_SECONDS
    ):
        status = "degraded"

    return {
        "status": status,
        "pending": pending,
        "retryable": retryable,
        "poisoned": poisoned,
        "active_leases": active_leases,
        "stale_leases": stale_leases,
        "oldest_pending_age_seconds": oldest_age,
        "max_attempts": max_attempts,
        "degraded_age_seconds": _OUTBOX_DEGRADED_AGE_SECONDS,
    }


def _record_outbox_alert(
    *,
    action: str,
    status: str,
    error: str | None = None,
) -> None:
    _METRICS["outbox_alert_last_action"] = action
    _METRICS["outbox_alert_last_status"] = status
    _METRICS["outbox_alert_last_at"] = utc_now().isoformat(timespec="seconds") + "Z"
    _METRICS["outbox_alert_last_error"] = error[:500] if error else None


def _outbox_alert_body(
    health: dict[str, int | str | None],
    *,
    action: str,
) -> str:
    return "\n".join(
        [
            f"action={action}",
            f"status={health['status']}",
            f"pending={health['pending']}",
            f"retryable={health['retryable']}",
            f"poisoned={health['poisoned']}",
            f"active_leases={health['active_leases']}",
            f"stale_leases={health['stale_leases']}",
            f"oldest_pending_age_seconds={health['oldest_pending_age_seconds']}",
            f"max_attempts={health['max_attempts']}",
            "Check GET /api/v1/admin/release-health",
            "Recover via /admin/outbox-dead-letters",
        ]
    )


async def _maybe_outbox_ops_alert(snapshot: dict[str, object]) -> None:
    """Alert once per degradation/escalation and once on confirmed recovery."""
    global _outbox_alerted_status

    health = _bounded_outbox_health(snapshot)
    status = str(health["status"])
    _METRICS["outbox_status"] = status
    _METRICS["outbox_health"] = health
    _METRICS["outbox_alerted_status"] = _outbox_alerted_status

    action: str | None = None
    if status == "healthy":
        if _outbox_alerted_status in {"degraded", "critical"}:
            action = "recovery"
    elif status == "critical":
        if _outbox_alerted_status != "critical":
            action = "critical"
    elif status == "degraded" and _outbox_alerted_status is None:
        action = "degraded"

    if action is None:
        return

    from app.core.config import settings

    to = (settings.ops_alert_email or "").strip()
    if not to:
        _record_outbox_alert(
            action=action,
            status="not_configured",
            error="ops_alert_email_missing",
        )
        return

    subject = (
        "Renova RECOVERY: domain outbox healthy"
        if action == "recovery"
        else f"Renova ALERT: domain outbox {action}"
    )
    try:
        from app.services.email_service import send_ops_alert_email

        delivered = await send_ops_alert_email(
            to,
            subject,
            _outbox_alert_body(health, action=action),
        )
        if not delivered:
            _record_outbox_alert(
                action=action,
                status="preview",
                error="smtp_not_configured_local_preview",
            )
            logger.warning(
                "outbox ops alert preview only action=%s status=%s",
                action,
                status,
            )
            return

        if action == "recovery":
            _outbox_alerted_status = None
        else:
            _outbox_alerted_status = status
        _METRICS["outbox_alerted_status"] = _outbox_alerted_status
        _METRICS["outbox_alert_count"] = int(_METRICS["outbox_alert_count"]) + 1
        _record_outbox_alert(action=action, status="sent")
        logger.error(
            "outbox ops alert delivered action=%s status=%s pending=%s poisoned=%s stale_leases=%s",
            action,
            status,
            health["pending"],
            health["poisoned"],
            health["stale_leases"],
        )
    except Exception as exc:  # noqa: BLE001 — retry the same transition next tick
        _record_outbox_alert(
            action=action,
            status="failed",
            error=f"{type(exc).__name__}: {exc}",
        )
        logger.exception("outbox ops alert email failed action=%s", action)


async def _maybe_ops_alert() -> None:
    """After 3+ failures, retry until SMTP confirms provider acceptance."""
    global _ops_alert_sent_for_streak
    fails = int(_METRICS["consecutive_failures"])
    if fails < 3:
        _ops_alert_sent_for_streak = False
        return
    if _ops_alert_sent_for_streak:
        return

    from app.core.config import settings

    to = (settings.ops_alert_email or "").strip()
    if not to:
        _record_ops_alert("not_configured", "ops_alert_email_missing")
        return

    try:
        from app.services.email_service import send_ops_alert_email

        delivered = await send_ops_alert_email(
            to,
            f"Renova ALERT: automation worker ({fails} fails)",
            f"consecutive_failures={fails}\nlast_error={_METRICS.get('last_error')}\n"
            f"last_tick_at={_METRICS.get('last_tick_at')}\n"
            "Check GET /api/v1/automation/worker",
        )
        if not delivered:
            _record_ops_alert("preview", "smtp_not_configured_local_preview")
            logger.warning("ops alert preview only; SMTP did not accept delivery to %s", to)
            return
        _ops_alert_sent_for_streak = True
        _record_ops_alert("sent")
        logger.error("ops alert email delivered to SMTP for %s", to)
    except Exception as exc:  # noqa: BLE001 — health loop must continue and retry next tick
        _record_ops_alert("failed", f"{type(exc).__name__}: {exc}")
        logger.exception("ops alert email failed")


def _record_ok(result: dict) -> None:
    global _ops_alert_sent_for_streak
    _ops_alert_sent_for_streak = False
    now = utc_now().isoformat(timespec="seconds") + "Z"
    _METRICS["last_tick_at"] = now
    _METRICS["last_ok_at"] = now
    _METRICS["last_error"] = None
    _METRICS["consecutive_failures"] = 0
    _METRICS["ticks_total"] = int(_METRICS["ticks_total"]) + 1
    _METRICS["ticks_ok"] = int(_METRICS["ticks_ok"]) + 1
    _METRICS["last_result"] = result


def _record_fail(exc: BaseException) -> None:
    now = utc_now().isoformat(timespec="seconds") + "Z"
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
    """Enqueue tomorrow's waste pickup reminders once per order and date."""
    scan_date = on_date or utc_now().date()
    tomorrow = scan_date + timedelta(days=1)
    result = await db.execute(
        select(WasteOrder).where(
            WasteOrder.scheduled_date == tomorrow,
            WasteOrder.status == WasteOrderStatus.scheduled,
        )
    )
    enqueued = 0
    for waste_order in result.scalars().all():
        project = await db.get(Project, waste_order.project_id)
        if project and project.customer_id:
            created = await enqueue_notification_once(
                db,
                dedupe_key=(
                    f"waste:{waste_order.id}:{project.customer_id}:"
                    f"{tomorrow.isoformat()}"
                ),
                project_id=waste_order.project_id,
                user_id=project.customer_id,
                notification_type="waste_reminder",
                title="Завтра вывоз мусора",
                body=f"{waste_order.volume_m3} м³",
                link_path="/(customer)/(tabs)/calendar",
            )
            if created:
                enqueued += 1
    return enqueued


async def run_automation_reminder_tick(*, on_date: date | None = None) -> dict:
    """Scan, dispatch, and proactively surface durable outbox degradation."""
    project_actions: list[str] = []
    waste_enqueued = 0
    dispatched = 0
    from app.db import session as db_session
    from app.services.outbox_dead_letter_service import runtime_health as outbox_runtime_health

    async with db_session.SessionLocal() as db:
        projects = list((await db.execute(select(Project))).scalars().all())
        for project in projects:
            await db.refresh(project, ["stages"])
            project_actions.extend(
                await scan_project_reminders(db, project, on_date=on_date)
            )
        waste_enqueued = await scan_waste_reminders(db, on_date=on_date)
        await db.commit()

        # The same durable dispatcher is used by the background outbox worker.
        # Leases and owner-fenced completion make concurrent manual/background
        # dispatch safe, while keeping the admin tick end-to-end observable.
        dispatched = await dispatch_pending(
            db,
            limit=max(20, len(project_actions) + waste_enqueued),
            worker_id="automation-reminders",
        )
        outbox_health = await outbox_runtime_health(db)
        await _maybe_outbox_ops_alert(outbox_health)
        bounded_health = _bounded_outbox_health(outbox_health)
    return {
        "project_actions": len(project_actions),
        "waste_sent": waste_enqueued,
        "reminders_enqueued": len(project_actions) + waste_enqueued,
        "outbox_dispatched": dispatched,
        "outbox_status": bounded_health["status"],
    }


async def automation_reminders_loop(stop: asyncio.Event, *, interval_sec: float) -> None:
    """Background loop — started from FastAPI lifespan."""
    logger.info("automation reminders worker started (interval=%ss)", interval_sec)
    while not stop.is_set():
        try:
            result = await run_automation_reminder_tick()
            _record_ok(result)
            if result["reminders_enqueued"] or result["outbox_dispatched"]:
                logger.info("automation tick: %s", result)
        except Exception as exc:  # noqa: BLE001 — keep the health loop alive
            _record_fail(exc)
            logger.exception("automation reminders tick failed")
            try:
                await _maybe_ops_alert()
            except Exception:  # pragma: no cover — defensive hook isolation
                logger.exception("ops alert hook failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(60.0, interval_sec))
            break
        except asyncio.TimeoutError:
            continue
    logger.info("automation reminders worker stopped")
