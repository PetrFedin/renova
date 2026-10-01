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


REWORK_SLA_MAX_AHEAD_DAYS = 14


def _rework_http_error(status: int, code: str, message: str):
    from fastapi import HTTPException

    return HTTPException(status, detail={"code": code, "message": message})


async def _rework_stage(db: AsyncSession, project_id: str, stage_id: str) -> Stage:
    st = await db.get(Stage, stage_id)
    if not st or st.project_id != project_id:
        from fastapi import HTTPException

        raise HTTPException(404, detail={"code": "stage_not_found"})
    if not st.needs_rework:
        raise _rework_http_error(409, "rework_not_requested", "Этап не возвращён на доработку — срок продлевать нечего")
    return st


@router.post("/{project_id}/rework-sla/extend")
async def extend_rework_sla(project_id: str, stage_id: str, days: int = 1, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Продление срока доработки — решение заказчика (STG-002).

    Заказчик-владелец продлевает срок сам. Исполнитель (и его бригада) срок не
    меняет: его вызов — это *запрос* продления: заказчику уходит одно уведомление
    (дедупликация по этапу, сроку и числу дней) и запись в обсуждении этапа, а срок
    остаётся прежним, пока заказчик не подтвердит тем же вызовом. Состояния запроса
    отдельно не хранятся — без миграций «ожидает решения» = заказчик ещё не продлил
    и не отклонил.
    """
    from app.api.deps import require_project
    from app.models.entities import StageComment
    from app.services.project_role_policy import ROLE_CUSTOMER, project_actor_role

    p = await require_project(db, project_id, user, write=True)
    st = await _rework_stage(db, project_id, stage_id)
    step = max(1, min(7, days))
    role = await project_actor_role(db, user, p)
    if role == ROLE_CUSTOMER:
        base = max(st.rework_deadline or utc_now(), utc_now())
        new_deadline = base + timedelta(days=step)
        if new_deadline > utc_now() + timedelta(days=REWORK_SLA_MAX_AHEAD_DAYS):
            raise _rework_http_error(422, "rework_sla_limit", f"Срок доработки не может быть дальше {REWORK_SLA_MAX_AHEAD_DAYS} дн. от сегодня")
        st.rework_deadline = new_deadline
        db.add(StageComment(stage_id=st.id, user_id=user.id, author_role="customer", text=f"Срок доработки продлён на {step} дн. — до {new_deadline.date().isoformat()}"))
        executor = st.assignee_id or p.contractor_id
        if executor:
            await reminder_outbox.enqueue_notification_once(
                db,
                dedupe_key=f"rework_sla_extended:{st.id}:{new_deadline.date().isoformat()}",
                project_id=project_id,
                user_id=executor,
                notification_type='stage_review',
                title='Срок доработки продлён',
                body=f'{st.name}: до {new_deadline.date().isoformat()}',
                link_path=f'/stage/{st.id}',
                return_to='/(contractor)/(tabs)/plan',
            )
        await db.commit()
        return {"ok": True, "status": "extended", "rework_deadline": st.rework_deadline.isoformat()}

    if role not in ("lead", "foreman"):
        raise _rework_http_error(403, "rework_sla_extend_forbidden", "Запросить продление срока доработки может ведущий исполнитель или прораб")
    requested_to = (st.rework_deadline or utc_now()) + timedelta(days=step)
    is_new = True
    if p.customer_id:
        is_new = await reminder_outbox.enqueue_notification_once(
            db,
            dedupe_key=f"rework_sla_extend_request:{st.id}:{(st.rework_deadline or utc_now()).date().isoformat()}:{step}",
            project_id=project_id,
            user_id=p.customer_id,
            notification_type='stage_review',
            title='Запрос продления срока доработки',
            body=f'{st.name}: исполнитель просит +{step} дн. (до {requested_to.date().isoformat()})',
            link_path=f'/stage/{st.id}',
            return_to='/(customer)/(tabs)/repair?tab=control',
        )
    if is_new:  # повторный запрос не множит записи в обсуждении
        db.add(StageComment(stage_id=st.id, user_id=user.id, author_role="contractor", text=f"Запрос продления срока доработки на {step} дн. — до {requested_to.date().isoformat()}"))
    await db.commit()
    return {"ok": True, "status": "requested", "rework_deadline": st.rework_deadline.isoformat() if st.rework_deadline else None, "requested_deadline": requested_to.isoformat()}


@router.post("/{project_id}/rework-sla/decline")
async def decline_rework_sla_extension(project_id: str, stage_id: str, reason: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Заказчик отклоняет запрос продления: срок остаётся, исполнитель получает ответ."""
    from app.api.deps import require_project
    from app.models.entities import StageComment
    from app.services.project_role_policy import require_project_owner

    p = await require_project(db, project_id, user, write=True)
    await require_project_owner(db, user, p, action="Отклонить продление срока доработки")
    st = await _rework_stage(db, project_id, stage_id)
    note = (reason or "").strip()[:500]
    db.add(StageComment(stage_id=st.id, user_id=user.id, author_role="customer", text="Продление срока доработки отклонено" + (f": {note}" if note else "")))
    executor = st.assignee_id or p.contractor_id
    if executor:
        await reminder_outbox.enqueue_notification_once(
            db,
            dedupe_key=f"rework_sla_declined:{st.id}:{utc_now().isoformat()}",
            project_id=project_id,
            user_id=executor,
            notification_type='stage_review',
            title='Продление срока отклонено',
            body=f'{st.name}: срок остаётся {st.rework_deadline.date().isoformat() if st.rework_deadline else "прежним"}',
            link_path=f'/stage/{st.id}',
            return_to='/(contractor)/(tabs)/plan',
        )
    await db.commit()
    return {"ok": True, "status": "declined", "rework_deadline": st.rework_deadline.isoformat() if st.rework_deadline else None}
