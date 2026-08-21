from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.api.v1.admin_outbox_dead_letters import router as outbox_dead_letter_router
from app.db.session import get_db
from app.models.entities import AuditLog, Project, User

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
async def stats(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    pc = (await db.execute(select(func.count()).select_from(Project))).scalar() or 0
    uc = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
    ac = (await db.execute(select(func.count()).select_from(AuditLog))).scalar() or 0
    return {"projects": pc, "users": uc, "audit_events": ac}


@router.get("/projects-chart")
async def projects_chart(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.entities import StageStatus

    r = await db.execute(select(Project).where(Project.contractor_id == user.id))
    out = []
    for p in r.scalars().all():
        await db.refresh(p, ["stages"])
        done = sum(1 for s in p.stages if s.status == StageStatus.done)
        out.append(
            {
                "name": p.name[:20],
                "done": done,
                "total": len(p.stages),
                "progress": round(
                    sum(s.percent_complete for s in p.stages)
                    / (len(p.stages) or 1)
                ),
            }
        )
    return out


@router.get("/revenue-chart")
async def revenue_chart(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.entities import LineType, PaymentStatus

    r = await db.execute(select(Project).where(Project.contractor_id == user.id))
    out = []
    for p in r.scalars().all():
        await db.refresh(p, ["estimate_lines", "payments"])
        mp = sum(
            line.quantity_planned * line.unit_price
            for line in p.estimate_lines
            if line.line_type == LineType.material
        )
        paid = sum(
            payment.amount
            for payment in p.payments
            if payment.status == PaymentStatus.confirmed
        )
        out.append(
            {
                "name": p.name[:20],
                "margin": round(p.budget_planned - mp, 0),
                "paid": round(paid, 0),
                "planned": round(p.budget_planned, 0),
            }
        )
    return out


@router.get("/release-health")
async def release_health(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.config import settings
    from app.services.automation_reminders_worker import automation_worker_metrics
    from app.services.esign import list_providers
    from app.services.fns.receipt_verify import fns_receipt_health
    from app.services.otp_redis_recovery import recovery_snapshot as otp_store_health
    from app.services.outbox_dead_letter_service import runtime_health as outbox_runtime_health
    from app.services.push_receipt_service import runtime_snapshot as push_receipt_runtime_health
    from app.services.release_health_service import truthful_release_snapshot
    from app.services.runtime_health_truth import automation_worker_runtime_truth
    from app.services.runtime_topology import worker_pool_snapshot
    from app.services.yookassa_service import yookassa_health

    release_snapshot = truthful_release_snapshot()
    release = release_snapshot["release"]
    observability = release_snapshot["observability"]
    metrics = observability["metrics"]

    yk = yookassa_health()
    fns = fns_receipt_health()
    manual_tick_metrics = automation_worker_metrics()
    manual_tick_truth = automation_worker_runtime_truth(manual_tick_metrics)
    worker_pool = await worker_pool_snapshot()
    otp_store = otp_store_health()
    kontur_mode = (settings.kontur_mode or "off").strip().lower()
    esign = {
        "kontur_mode": kontur_mode,
        "kontur_configured": bool(settings.kontur_api_key)
        and kontur_mode in ("sandbox", "live"),
        "webhook_secret_set": bool(settings.esign_webhook_secret),
        "providers": list_providers(),
    }
    outbox_health = await outbox_runtime_health(db)
    push_receipts = await push_receipt_runtime_health(db)
    return {
        "contract_version": release_snapshot["contract_version"],
        "generated_at": release_snapshot["generated_at"],
        "version": release["version"],
        "commit_sha": release["commit_sha"],
        "crash_free_rate": metrics["crash_free_rate"],
        "sessions": metrics["sessions"],
        "source": metrics["source"],
        "environment": settings.normalized_environment,
        "release": release,
        "observability": observability,
        "runtime_topology": {
            "api": {
                "role": "renova-api",
                "background_jobs_embedded": False,
                "websocket_bridge_local": bool((settings.redis_url or "").strip()),
            },
            "worker_pool": worker_pool,
        },
        "integrations": {
            "yookassa": {
                "configured": yk["configured"],
                "live_checkout_ready": yk["live_checkout_ready"],
                "demo_allowed": yk["demo_allowed"],
            },
            "fns": {
                "receipt_auth_configured": fns["receipt_auth_configured"],
                "live_verify_ready": fns["live_verify_ready"],
                "demo_verify_allowed": fns["demo_verify_allowed"],
            },
            "esign": esign,
            "smtp": {"configured": bool(settings.smtp_host)},
            "ollama_digest": {
                "enabled": bool(settings.ollama_digest_enabled),
                "base_url_set": bool(settings.ollama_base_url),
            },
            "otp_store": otp_store,
            "automation_worker": {
                "enabled": settings.automation_reminders_enabled,
                "runtime_owner": "renova-worker",
                "healthy": worker_pool["healthy"],
                "status": worker_pool["status"],
                "worker_pool": worker_pool,
                "manual_tick": {
                    **manual_tick_truth,
                    "consecutive_failures": manual_tick_metrics.get("consecutive_failures"),
                    "outbox_status": manual_tick_metrics.get("outbox_status"),
                },
            },
            "outbox": {
                "runtime_owner": "renova-worker",
                **outbox_health,
            },
            "push_receipts": {
                "runtime_owner": "renova-worker",
                "worker_enabled": settings.push_receipt_worker_enabled,
                **push_receipts,
            },
        },
    }


@router.get("/h0-readiness")
async def h0_readiness(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """H0 staging checklist for a permitted administrator."""
    from app.services.staging_readiness import build_h0_readiness_with_database

    return await build_h0_readiness_with_database(db)


router.include_router(outbox_dead_letter_router)
