"""Единый архив действий по проекту."""
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ActivityEvent, DomainOutbox, RoomChangeLog
from app.models.outbox_runtime import SideEffectDelivery

_AUTOMATION_TRIGGER = "trigger"
_AUTOMATION_EVIDENCE_ONLY = "evidence_only"
# These parent workflows already own complete notification fan-out. Their
# activity rows are immutable evidence, not a second automation trigger.
_EVIDENCE_ONLY_AGGREGATE_TYPES = {"work_acceptance_effect", "purchase"}


def _stage_id_from_link_path(link_path: str | None) -> str | None:
    if not link_path or not link_path.startswith("/stage/"):
        return None
    stage_id = link_path.removeprefix("/stage/").split("?", 1)[0].split("/", 1)[0]
    return stage_id or None


async def _outbox_source(
    db: AsyncSession,
    outbox_id: str,
) -> tuple[DomainOutbox, dict]:
    row = await db.get(DomainOutbox, outbox_id)
    if row is None:
        raise RuntimeError("outbox_activity_source_missing")
    try:
        decoded = json.loads(row.payload_json or "{}")
    except (TypeError, ValueError) as exc:
        raise RuntimeError("outbox_activity_payload_invalid") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("outbox_activity_payload_invalid")
    return row, decoded


def _automation_mode(row: DomainOutbox, payload: dict) -> str:
    configured = payload.get("automation_mode")
    if configured is None:
        return (
            _AUTOMATION_EVIDENCE_ONLY
            if row.aggregate_type in _EVIDENCE_ONLY_AGGREGATE_TYPES
            else _AUTOMATION_TRIGGER
        )
    if configured not in {_AUTOMATION_TRIGGER, _AUTOMATION_EVIDENCE_ONLY}:
        raise RuntimeError("outbox_activity_automation_mode_invalid")
    return configured


def _resolve_outbox_stage_id(
    payload: dict,
    *,
    stage_id: str | None,
    link_path: str | None,
) -> str | None:
    if stage_id:
        return stage_id
    payload_stage_id = payload.get("stage_id")
    if isinstance(payload_stage_id, str) and payload_stage_id:
        return payload_stage_id
    payload_link_path = payload.get("link_path")
    return _stage_id_from_link_path(
        link_path or (payload_link_path if isinstance(payload_link_path, str) else None)
    )


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
    from app.services.client_write_side_effects import (
        payment_transition_side_effects_suppressed,
        take_client_write_side_effect,
    )

    if payment_transition_side_effects_suppressed() and kind == "PaymentApproved":
        return None

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
            stage_id=stage_id,
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
    try:
        await db.flush()
        event_id = event.id
        from app.services import automation_engine as automation

        await automation.prepare_event_effects(
            db,
            kind=kind,
            project_id=project_id,
            user_id=user_id,
            stage_id=stage_id,
            body=body,
            room_id=room_id,
            source_activity_id=event_id,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    from app.services import outbox_inline_dispatch

    await outbox_inline_dispatch.dispatch_best_effort(
        db,
        source="activity.log_event",
        limit=10,
    )
    persisted = await db.get(ActivityEvent, event_id)
    if not persisted:
        raise RuntimeError("committed_activity_missing")
    return persisted


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
    stage_id: str | None = None,
) -> ActivityEvent:
    row, payload = await _outbox_source(db, outbox_id)
    automation_mode = _automation_mode(row, payload)
    resolved_stage_id = _resolve_outbox_stage_id(
        payload,
        stage_id=stage_id,
        link_path=link_path,
    )
    delivery = (
        await db.execute(
            select(SideEffectDelivery).where(SideEffectDelivery.outbox_id == outbox_id)
        )
    ).scalar_one_or_none()
    if delivery:
        event = await db.get(ActivityEvent, delivery.entity_id)
        if not event:
            raise RuntimeError("outbox_activity_target_missing")
        if automation_mode == _AUTOMATION_TRIGGER:
            from app.services import automation_engine as automation

            await automation.prepare_event_effects(
                db,
                kind=kind,
                project_id=project_id,
                user_id=user_id,
                stage_id=resolved_stage_id,
                body=body,
                room_id=room_id,
                source_activity_id=event.id,
                parent_outbox_id=outbox_id,
            )
        await db.commit()
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
    if automation_mode == _AUTOMATION_TRIGGER:
        from app.services import automation_engine as automation

        await automation.prepare_event_effects(
            db,
            kind=kind,
            project_id=project_id,
            user_id=user_id,
            stage_id=resolved_stage_id,
            body=body,
            room_id=room_id,
            source_activity_id=event.id,
            parent_outbox_id=outbox_id,
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
