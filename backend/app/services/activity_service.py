"""Единый архив действий по проекту."""
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import ActivityEvent, RoomChangeLog, ChangeOrder, Stage, MaterialPick


async def log_event(db: AsyncSession, *, project_id: str, user_id: str | None, kind: str, title: str, body: str | None = None, room_id: str | None = None, work_type: str | None = None, link_path: str | None = None, stage_id: str | None = None):
    e = ActivityEvent(project_id=project_id, user_id=user_id, kind=kind, title=title, body=body, room_id=room_id, work_type=work_type, link_path=link_path)
    db.add(e)
    await db.commit()
    try:
        from app.services import automation_engine as auto
        await auto.process_event(db, kind=kind, project_id=project_id, user_id=user_id, stage_id=stage_id, body=body, room_id=room_id)
    except Exception:
        pass
    return e


async def project_feed(db: AsyncSession, project_id: str, kind: str | None = None, work_type: str | None = None, room_id: str | None = None, limit: int = 50) -> list[dict]:
    items: list[dict] = []
    q = select(ActivityEvent).where(ActivityEvent.project_id == project_id)
    if kind: q = q.where(ActivityEvent.kind == kind)
    if work_type: q = q.where(ActivityEvent.work_type == work_type)
    if room_id: q = q.where(ActivityEvent.room_id == room_id)
    r = await db.execute(q.order_by(ActivityEvent.created_at.desc()).limit(limit))
    for e in r.scalars().all():
        items.append({"id": e.id, "kind": e.kind, "title": e.title, "body": e.body, "work_type": e.work_type, "room_id": e.room_id, "link_path": e.link_path, "at": e.created_at.isoformat()})
    if len(items) < limit:
        logs = await db.execute(select(RoomChangeLog).where(RoomChangeLog.room_id.in_(select(ActivityEvent.room_id).where(ActivityEvent.project_id == project_id)) if False else True))
    # merge legacy room logs
    from app.models.entities import Room
    rooms = (await db.execute(select(Room.id).where(Room.project_id == project_id))).scalars().all()
    if rooms:
        rq = select(RoomChangeLog).where(RoomChangeLog.room_id.in_(rooms))
        if room_id: rq = rq.where(RoomChangeLog.room_id == room_id)
        lr = await db.execute(rq.order_by(RoomChangeLog.created_at.desc()).limit(20))
        for lg in lr.scalars().all():
            items.append({"id": f"log-{lg.id}", "kind": "room_change", "title": f"Комната: {lg.field_name}", "body": f"{lg.old_value} → {lg.new_value}", "work_type": None, "room_id": lg.room_id, "link_path": f"/room/{lg.room_id}", "at": lg.created_at.isoformat()})
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:limit]
