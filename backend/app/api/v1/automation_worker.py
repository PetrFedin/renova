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
from app.services.runtime_health_truth import automation_worker_runtime_truth
from app.services.runtime_topology import worker_pool_snapshot

router = APIRouter(prefix="/automation", tags=["automation"])


@router.get("/worker")
async def automation_worker_status(
    _user: User = Depends(require_admin_user),
):
    """Report the external worker pool and keep API-local manual-tick metrics separate."""
    metrics = automation_worker_metrics()
    manual_tick = {
        **automation_worker_runtime_truth(metrics),
        **metrics,
    }
    pool = await worker_pool_snapshot()
    return {
        "enabled": settings.automation_reminders_enabled,
        "interval_sec": settings.automation_reminders_interval_sec,
        "runtime_owner": "renova-worker",
        "healthy": pool["healthy"],
        "status": pool["status"],
        "worker_pool": pool,
        "manual_tick": manual_tick,
    }


@router.post("/worker/tick")
async def automation_worker_tick(
    _user: User = Depends(require_admin_user),
):
    """Run one explicit admin tick; this does not become the background runtime."""
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
            "runtime_owner": "manual_admin_tick",
            **result,
        }
    except Exception as exc:
        _record_fail(exc)
        # Internal provider/database details stay in metrics/logging, not HTTP.
        raise HTTPException(
            500,
            detail={"code": "automation_tick_failed"},
        ) from exc
