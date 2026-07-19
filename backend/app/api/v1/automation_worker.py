"""Automation reminders worker ops (P4.2a)."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
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
async def automation_worker_status(user: User = Depends(get_current_user)):
    m = automation_worker_metrics()
    return {
        "enabled": settings.automation_reminders_enabled,
        "interval_sec": settings.automation_reminders_interval_sec,
        "healthy": int(m.get("consecutive_failures") or 0) < 3,
        **m,
    }


@router.post("/worker/tick")
async def automation_worker_tick(user: User = Depends(get_current_user)):
    """Manual tick — same as background loop (e2e / ops)."""
    try:
        result = await run_automation_reminder_tick()
        _record_ok(result)
        return {"ok": True, **result}
    except Exception as exc:
        _record_fail(exc)
        raise HTTPException(500, f"automation_tick_failed: {exc}") from exc
