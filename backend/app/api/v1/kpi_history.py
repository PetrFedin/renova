from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, MarginSnapshot
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
    return [{"margin": s.margin_estimated, "at": s.recorded_at.isoformat()} for s in reversed(list(r.scalars().all()))]


@router.post("/{project_id}/kpi-snapshot")
async def snapshot(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    p = await ps.get_project(db, project_id)
    margin = (p.budget_planned - p.budget_spent) if p else 0
    s = MarginSnapshot(project_id=project_id, margin_estimated=margin)
    db.add(s)
    await db.commit()
    return {"ok": True, "margin": margin}
