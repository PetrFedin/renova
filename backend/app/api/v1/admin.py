from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.api.v1.admin_outbox_dead_letters import router as outbox_dead_letter_router
from app.api.v1.admin_provider_reconciliations import router as provider_reconciliation_router
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


_CHART_GROUP_LIMIT = 20


def _group_name(value) -> str:
    return str(getattr(value, "value", value) or "other")[:20]


@router.get("/projects-chart")
async def projects_chart(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Платформенный агрегат по типам ремонта (MKT-032): без названий и владельцев проектов."""
    from app.models.entities import Stage, StageStatus

    project_counts = {
        _group_name(kind): int(count)
        for kind, count in (
            await db.execute(
                select(Project.renovation_type, func.count()).group_by(Project.renovation_type)
            )
        ).all()
    }
    stage_rows = (
        await db.execute(
            select(
                Project.renovation_type,
                func.count(Stage.id),
                func.sum(case((Stage.status == StageStatus.done, 1), else_=0)),
                func.avg(Stage.percent_complete),
            )
            .join(Stage, Stage.project_id == Project.id)
            .group_by(Project.renovation_type)
        )
    ).all()
    stages = {
        _group_name(kind): (int(total or 0), int(done or 0), float(avg or 0))
        for kind, total, done, avg in stage_rows
    }
    out = []
    for name, projects in sorted(project_counts.items(), key=lambda x: -x[1])[:_CHART_GROUP_LIMIT]:
        total, done, avg = stages.get(name, (0, 0, 0.0))
        out.append(
            {
                "name": name,
                "projects": projects,
                "done": done,
                "total": total,
                "progress": round(avg),
            }
        )
    return out


@router.get("/revenue-chart")
async def revenue_chart(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Платформенный агрегат по типам ремонта (MKT-032).

    ``materials_planned`` — плановые материалы по смете; ``plan_minus_materials`` — план
    за вычетом плановых материалов (ранее называлось «margin», маржой не является).
    """
    from app.models.entities import EstimateLine, LineType, Payment, PaymentStatus

    planned_rows = (
        await db.execute(
            select(Project.renovation_type, func.coalesce(func.sum(Project.budget_planned), 0.0))
            .group_by(Project.renovation_type)
        )
    ).all()
    paid = {
        _group_name(kind): float(total or 0)
        for kind, total in (
            await db.execute(
                select(Project.renovation_type, func.coalesce(func.sum(Payment.amount), 0.0))
                .join(Payment, Payment.project_id == Project.id)
                .where(Payment.status == PaymentStatus.confirmed)
                .group_by(Project.renovation_type)
            )
        ).all()
    }
    materials = {
        _group_name(kind): float(total or 0)
        for kind, total in (
            await db.execute(
                select(
                    Project.renovation_type,
                    func.coalesce(func.sum(EstimateLine.quantity_planned * EstimateLine.unit_price), 0.0),
                )
                .join(EstimateLine, EstimateLine.project_id == Project.id)
                .where(EstimateLine.line_type == LineType.material)
                .group_by(Project.renovation_type)
            )
        ).all()
    }
    out = []
    for kind, planned in sorted(planned_rows, key=lambda x: -float(x[1] or 0))[:_CHART_GROUP_LIMIT]:
        name = _group_name(kind)
        planned = float(planned or 0)
        mat = materials.get(name, 0.0)
        out.append(
            {
                "name": name,
                "planned": round(planned, 0),
                "paid": round(paid.get(name, 0.0), 0),
                "materials_planned": round(mat, 0),
                "plan_minus_materials": round(planned - mat, 0),
            }
        )
    return out


@router.get("/release-health")
async def release_health(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.config import settings
    from app.services import moy_nalog_oauth
    from app.services.automation_reminders_worker import automation_worker_metrics
    from app.services.capacity_runtime_service import capacity_runtime_snapshot
    from app.services.esign import list_providers
    from app.services.fns.receipt_verify import fns_receipt_health
    from app.services.otp_redis_recovery import recovery_snapshot as otp_store_health
    from app.services.outbox_dead_letter_service import runtime_health as outbox_runtime_health
    from app.services.provider_reconciliation_service import runtime_snapshot as provider_reconciliation_runtime
    from app.services.push_receipt_service import runtime_snapshot as push_receipt_runtime_health
    from app.services.release_health_service import truthful_release_snapshot
    from app.services.runtime_health_truth import automation_worker_runtime_truth
    from app.services.runtime_topology import api_pool_snapshot, worker_pool_snapshot
    from app.services.yookassa_service import yookassa_health

    release_snapshot = truthful_release_snapshot()
    release = release_snapshot["release"]
    observability = release_snapshot["observability"]
    metrics = observability["metrics"]

    yk = yookassa_health()
    fns = fns_receipt_health()
    moy_nalog = await moy_nalog_oauth.runtime_health()
    manual_tick_metrics = automation_worker_metrics()
    manual_tick_truth = automation_worker_runtime_truth(manual_tick_metrics)
    worker_pool = await worker_pool_snapshot()
    api_pool = await api_pool_snapshot()
    capacity = await capacity_runtime_snapshot(
        db,
        worker_pool=worker_pool,
        api_pool=api_pool,
    )
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
    provider_reconciliation = await provider_reconciliation_runtime(db)
    provider_reconciliation_status = (
        "critical" if int(provider_reconciliation["terminal_total"]) > 0 else "healthy"
    )
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
        "capacity": capacity,
        "runtime_topology": {
            "api": {
                "role": "renova-api",
                "background_jobs_embedded": False,
                "websocket_bridge_local": bool((settings.redis_url or "").strip()),
            },
            "api_pool": api_pool,
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
            "moy_nalog": moy_nalog,
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
            "provider_reconciliation": {
                "runtime_owner": "renova-worker",
                "healthy": provider_reconciliation_status == "healthy",
                "status": provider_reconciliation_status,
                "recovery_ready": True,
                **provider_reconciliation,
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
router.include_router(provider_reconciliation_router)
