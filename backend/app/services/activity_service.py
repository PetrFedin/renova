"""Единый архив действий по проекту."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ActivityEvent, RoomChangeLog
from app.models.outbox_runtime import SideEffectDelivery


async def log_event(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str | None,
    kind: str,
    title: str,
    body: str | None = None,
    room_id: str | None = None,
    work_type: str | None = None,
    link_path: str | None = None,
    stage_id: str | None = None,
):
    from app.services.client_write_side_effects import take_client_write_side_effect

    outbox_id = take_client_write_side_effect("activity")
    if outbox_id:
        return await log_event_from_outbox(
            db,
            outbox_id=outbox_id,
            project_id=project_id,
            user_id=user_id,
            kind=kind,
            title=title,
            body=body,
            room_id=room_id,
            work_type=work_type,
            link_path=link_path,
        )

    event = ActivityEvent(
        project_id=project_id,
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        room_id=room_id,
        work_type=work_type,
        link_path=link_path,
    )
    db.add(event)
    await db.commit()
    try:
        from app.services import automation_engine as automation
        await automation.process_event(
            db,
            kind=kind,
            project_id=project_id,
            user_id=user_id,
            stage_id=stage_id,
            body=body,
            room_id=room_id,
        )
    except Exception:
        pass
    return event


async def log_event_from_outbox(
    db: AsyncSession,
    *,
    outbox_id: str,
    project_id: str,
    user_id: str | None,
    kind: str,
    title: str,
    body: str | None = None,
    room_id: str | None = None,
    work_type: str | None = None,
    link_path: str | None = None,
) -> ActivityEvent:
    """Create one activity row even if the outbox event is handled repeatedly."""
    delivery = (
        await db.execute(
            select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == outbox_id)
        )
    ).scalar_one_or_none()
    if delivery:
        event = await db.get(ActivityEvent, delivery.entity_id)
        if not event:
            raise RuntimeError("outbox_activity_target_missing")
        return event

    event = ActivityEvent(
        project_id=project_id,
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        room_id=room_id,
        work_type=work_type,
        link_path=link_path,
    )
    db.add(event)
    await db.flush()
    db.add(
        SideEffectDelivery(
            outbox_id=outbox_id,
            effect_type="activity",
            entity_id=event.id,
            delivered_at=utc_now(),
        )
    )
    await db.commit()
    await db.refresh(event)
    return event


async def project_feed(
    db: AsyncSession,
    project_id: str,
    kind: str | None = None,
    work_type: str | None = None,
    room_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    items: list[dict] = []
    query = select(ActivityEvent).where(ActivityEvent.project_id == project_id)
    if kind:
        query = query.where(ActivityEvent.kind == kind)
    if work_type:
        query = query.where(ActivityEvent.work_type == work_type)
    if room_id:
        query = query.where(ActivityEvent.room_id == room_id)
    result = await db.execute(query.order_by(ActivityEvent.created_at.desc()).limit(limit))
    for event in result.scalars().all():
        items.append(
            {
                "id": event.id,
                "kind": event.kind,
                "title": event.title,
                "body": event.body,
                "work_type": event.work_type,
                "room_id": event.room_id,
                "link_path": event.link_path,
                "at": event.created_at.isoformat(),
            }
        )

    from app.models.entities import Room
    room_ids = (await db.execute(select(Room.id).where(Room.project_id == project_id))).scalars().all()
    if room_ids:
        room_query = select(RoomChangeLog).where(RoomChangeLog.room_id.in_(room_ids))
        if room_id:
            room_query = room_query.where(RoomChangeLog.room_id == room_id)
        legacy = await db.execute(room_query.order_by(RoomChangeLog.created_at.desc()).limit(20))
        for log in legacy.scalars().all():
            items.append(
                {
                    "id": f"log-{log.id}",
                    "kind": "room_change",
                    "title": f"Комната: {log.field_name}",
                    "body": f"{log.old_value} → {log.new_value}",
                    "work_type": None,
                    "room_id": log.room_id,
                    "link_path": f"/room/{log.room_id}",
                    "at": log.created_at.isoformat(),
                }
            )
    items.sort(key=lambda item: item["at"], reverse=True)
    return items[:limit]
