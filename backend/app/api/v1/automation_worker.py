"""Automation reminder worker operations for platform administrators."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.admin_access import require_admin_user
from app.core.config import settings
from app.models.entities import User
from app.services.automation_reminders_worker import (
    _record_fail,
    _record_ok,
    automation_worker_metrics,
    run_automation_reminder_tick,
)

router = APIRouter(prefix="/automation", tags=["automation"])


def _worker_runtime_truth(metrics: dict) -> dict[str, object]:
    failures = int(metrics.get("consecutive_failures") or 0)
    tick_healthy = failures < 3
    outbox_status = str(metrics.get("outbox_status") or "unknown")
    outbox_healthy = outbox_status == "healthy"

    if not tick_healthy or outbox_status == "critical":
        status = "critical"
    elif outbox_status == "degraded":
        status = "degraded"
    elif outbox_status == "healthy":
        status = "healthy"
    else:
        status = "unknown"

    return {
        "healthy": status == "healthy",
        "status": status,
        "tick_healthy": tick_healthy,
        "outbox_healthy": outbox_healthy,
    }


@router.get("/worker")
async def automation_worker_status(
    _user: User = Depends(require_admin_user),
):
    metrics = automation_worker_metrics()
    return {
        "enabled": settings.automation_reminders_enabled,
        "interval_sec": settings.automation_reminders_interval_sec,
        **_worker_runtime_truth(metrics),
        **metrics,
    }


@router.post("/worker/tick")
async def automation_worker_tick(
    _user: User = Depends(require_admin_user),
):
    """Run the global tick and report execution separately from runtime health."""
    try:
        result = await run_automation_reminder_tick()
        _record_ok(result)
        outbox_status = str(result.get("outbox_status") or "unknown")
        runtime_healthy = outbox_status == "healthy"
        return {
            "ok": runtime_healthy,
            "tick_executed": True,
            "healthy": runtime_healthy,
            "status": outbox_status,
            "code": None if runtime_healthy else f"outbox_{outbox_status}",
            **result,
        }
    except Exception as exc:
        _record_fail(exc)
        # Internal provider/database details stay in metrics/logging, not HTTP.
        raise HTTPException(
            500,
            detail={"code": "automation_tick_failed"},
        ) from exc
