"""Напоминания SLA доработки за 24ч."""
from app.core.timeutil import utc_now
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, Stage, Project
from app.services import automation_reminder_outbox as reminder_outbox

router = APIRouter(prefix="/projects", tags=["rework-sla"])

def rework_reminder_key(stage_id: str, deadline: datetime) -> str:
    """Одно напоминание на этап и его срок.

    Ключ не включает время вызова: экран «Работы» зовёт эту ручку при каждом
    открытии, и без устойчивого ключа исполнитель получал новый push на каждый
    заход. Срок в ключе есть намеренно — продлили срок, значит это уже другое
    напоминание, и оно должно дойти.
    """
    return f"rework_sla:{stage_id}:{deadline.date().isoformat()}"


@router.post("/{project_id}/rework-sla/check")
async def check_rework_sla(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.api.deps import require_project

    # Ручка называется «check», но рассылает уведомления — то есть пишет.
    # С правом чтения её мог дёрнуть любой, кому виден объект, включая гостя
    # read-only, и телефон исполнителя звенел столько раз, сколько попросят.
    p = await require_project(db, project_id, user, write=True)
    now = utc_now()
    soon = now + timedelta(hours=24)
    r = await db.execute(select(Stage).where(Stage.project_id == project_id, Stage.needs_rework == True, Stage.rework_deadline != None, Stage.rework_deadline <= soon, Stage.rework_deadline > now))
    sent = 0
    skipped = 0
    for st in r.scalars().all():
        if not p.contractor_id:
            continue
        # Тот же механизм, что у остальных периодических напоминаний:
        # устойчивый ключ, долговечная очередь, доставка — на диспетчере.
        enqueued = await reminder_outbox.enqueue_notification_once(
            db,
            dedupe_key=rework_reminder_key(st.id, st.rework_deadline),
            project_id=project_id,
            user_id=p.contractor_id,
            notification_type='stage_review',
            title='SLA доработки завтра',
            body=f'{st.name} до {st.rework_deadline.date()}',
            link_path=f'/stage/{st.id}',
            return_to='/(contractor)/(tabs)/plan',
        )
        if enqueued:
            sent += 1
        else:
            skipped += 1
    await db.commit()
    # `already_sent` отделяет «напоминать было нечего» от «уже напомнили»:
    # без него повторный вызов выглядел бы как отсутствие просрочек.
    return {"ok": True, "reminders": sent, "already_sent": skipped}


@router.post("/{project_id}/rework-sla/extend")
async def extend_rework_sla(project_id: str, stage_id: str, days: int = 1, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import timedelta
    from app.api.deps import require_project
    await require_project(db, project_id, user, write=True)
    st = await db.get(Stage, stage_id)
    if not st or st.project_id != project_id:
        from fastapi import HTTPException
        raise HTTPException(404)
    st.rework_deadline = (st.rework_deadline or utc_now()) + timedelta(days=max(1, min(7, days)))
    await db.commit()
    return {"ok": True, "rework_deadline": st.rework_deadline.isoformat()}
