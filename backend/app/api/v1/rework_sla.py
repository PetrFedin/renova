"""Напоминания SLA доработки за 24ч."""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, Stage, Project
from app.services import notification_service as ns

router = APIRouter(prefix="/projects", tags=["rework-sla"])

@router.post("/{project_id}/rework-sla/check")
async def check_rework_sla(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.api.deps import require_project
    p = await require_project(db, project_id, user, write=False)
    now = datetime.utcnow()
    soon = now + timedelta(hours=24)
    r = await db.execute(select(Stage).where(Stage.project_id == project_id, Stage.needs_rework == True, Stage.rework_deadline != None, Stage.rework_deadline <= soon, Stage.rework_deadline > now))
    sent = 0
    for st in r.scalars().all():
        if p.contractor_id:
            await ns.notify(db, user_id=p.contractor_id, project_id=project_id, notification_type='stage_review', title='SLA доработки завтра', body=f'{st.name} до {st.rework_deadline.date()}', link_path=f'/stage/{st.id}', return_to='/(contractor)/(tabs)/plan')
            sent += 1
    return {"ok": True, "reminders": sent}


@router.post("/{project_id}/rework-sla/extend")
async def extend_rework_sla(project_id: str, stage_id: str, days: int = 1, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import timedelta
    from app.api.deps import require_project
    await require_project(db, project_id, user, write=True)
    st = await db.get(Stage, stage_id)
    if not st or st.project_id != project_id:
        from fastapi import HTTPException
        raise HTTPException(404)
    st.rework_deadline = (st.rework_deadline or datetime.utcnow()) + timedelta(days=max(1, min(7, days)))
    await db.commit()
    return {"ok": True, "rework_deadline": st.rework_deadline.isoformat()}
