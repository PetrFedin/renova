"""История остатка бюджета проекта (MKT-020).

Раньше метрика называлась «margin», хотя считалась как ``budget_planned - budget_spent`` —
это остаток бюджета, а не маржа. Таблица ``margin_snapshots`` (столбец
``margin_estimated``) историческая, переименование столбца потребовало бы миграции, поэтому
имя осталось только в БД; в API и UI метрика называется ``remaining``.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.models.entities import MarginSnapshot, User, UserRole
from app.services import project_service as ps

router = APIRouter(prefix="/projects", tags=["kpi"])


@router.get("/{project_id}/kpi-history")
async def history(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(
        select(MarginSnapshot)
        .where(MarginSnapshot.project_id == project_id)
        .order_by(MarginSnapshot.recorded_at.desc())
        .limit(30)
    )
    return [
        {"remaining": s.margin_estimated, "at": s.recorded_at.isoformat()}
        for s in reversed(list(r.scalars().all()))
    ]


@router.post("/{project_id}/kpi-snapshot")
async def snapshot(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Снимок остатка бюджета: только исполнитель проекта, не чаще раза в сутки."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})
    await require_project(db, project_id, user, write=True)
    p = await ps.get_project(db, project_id)
    remaining = (p.budget_planned - p.budget_spent) if p else 0
    since = utc_now() - timedelta(hours=24)
    existing = await db.scalar(
        select(MarginSnapshot)
        .where(MarginSnapshot.project_id == project_id, MarginSnapshot.recorded_at >= since)
        .order_by(MarginSnapshot.recorded_at.desc())
    )
    if existing is not None:
        existing.margin_estimated = remaining
    else:
        db.add(MarginSnapshot(project_id=project_id, margin_estimated=remaining))
    await db.commit()
    return {"ok": True, "remaining": remaining}
