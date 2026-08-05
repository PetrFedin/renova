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


@router.get("/worker")
async def automation_worker_status(
    _user: User = Depends(require_admin_user),
):
    metrics = automation_worker_metrics()
    return {
        "enabled": settings.automation_reminders_enabled,
        "interval_sec": settings.automation_reminders_interval_sec,
        "healthy": int(metrics.get("consecutive_failures") or 0) < 3,
        **metrics,
    }


@router.post("/worker/tick")
async def automation_worker_tick(
    _user: User = Depends(require_admin_user),
):
    """Run the same global tick as the background loop under admin RBAC."""
    try:
        result = await run_automation_reminder_tick()
        _record_ok(result)
        return {"ok": True, **result}
    except Exception as exc:
        _record_fail(exc)
        # Internal provider/database details stay in metrics/logging, not HTTP.
        raise HTTPException(
            500,
            detail={"code": "automation_tick_failed"},
        ) from exc
