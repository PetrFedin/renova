from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import AuditLog, Project, User, UserRole

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/stats")
async def stats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    pc = (await db.execute(select(func.count()).select_from(Project))).scalar() or 0
    uc = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
    ac = (await db.execute(select(func.count()).select_from(AuditLog))).scalar() or 0
    return {"projects": pc, "users": uc, "audit_events": ac}

@router.get("/projects-chart")
async def projects_chart(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from app.models.entities import Stage, StageStatus
    r = await db.execute(select(Project).where(Project.contractor_id == user.id))
    out = []
    for p in r.scalars().all():
        await db.refresh(p, ["stages"])
        done = sum(1 for s in p.stages if s.status == StageStatus.done)
        out.append({"name": p.name[:20], "done": done, "total": len(p.stages), "progress": round(sum(s.percent_complete for s in p.stages) / (len(p.stages) or 1))})
    return out


@router.get("/revenue-chart")
async def revenue_chart(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from app.models.entities import LineType, Payment, PaymentStatus
    r = await db.execute(select(Project).where(Project.contractor_id == user.id))
    out = []
    for p in r.scalars().all():
        await db.refresh(p, ["estimate_lines", "payments"])
        mp = sum(l.quantity_planned * l.unit_price for l in p.estimate_lines if l.line_type == LineType.material)
        paid = sum(x.amount for x in p.payments if x.status == PaymentStatus.confirmed)
        out.append({"name": p.name[:20], "margin": round(p.budget_planned - mp, 0), "paid": round(paid, 0), "planned": round(p.budget_planned, 0)})
    return out

@router.get("/release-health")
async def release_health(user: User = Depends(get_current_user)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from app.core.config import settings
    from app.services.yookassa_service import yookassa_health
    from app.services.automation_reminders_worker import automation_worker_metrics

    yk = yookassa_health()
    worker = automation_worker_metrics()
    return {
        "version": "1.0.0",
        "crash_free_rate": 99.2,
        "sessions": 1200,
        "source": "sentry-stub",
        "environment": settings.normalized_environment,
        "integrations": {
            "yookassa": {
                "configured": yk["configured"],
                "live_checkout_ready": yk["live_checkout_ready"],
                "demo_allowed": yk["demo_allowed"],
            },
            "smtp": {"configured": bool(settings.smtp_host)},
            "ollama_digest": {
                "enabled": bool(settings.ollama_digest_enabled),
                "base_url_set": bool(settings.ollama_base_url),
            },
            "automation_worker": {
                "healthy": int(worker.get("consecutive_failures") or 0) < 3,
                "consecutive_failures": worker.get("consecutive_failures"),
            },
        },
    }
