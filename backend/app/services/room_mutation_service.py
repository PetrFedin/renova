"""Role-scoped, atomic room create/update operations."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import EstimateLine, Project, Room, User, UserRole
from app.services import outbox_service as outbox
from app.services import room_service
from app.services import team_service

ROOM_CREATE_SCOPE = "room.create"
_DIRECT_NULLABLE_FIELDS = frozenset({"room_type", "notes", "budget_alert_pct"})


@dataclass(frozen=True)
class RoomMutationResult:
    room: Room
    replayed: bool
    changes: dict[str, dict[str, object]]


async def _require_direct_editor(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> None:
    """Customers must use Room Change; only writable contractor-side members edit directly."""
    if actor.role != UserRole.contractor:
        raise ValueError("room_direct_editor_forbidden")
    mode, read_only = await team_service.project_access_mode(db, actor, project)
    if mode != "contractor" or read_only:
        raise ValueError("room_direct_editor_forbidden")


def _create_payload(data: dict) -> dict:
    return {
        "name": str(data["name"]).strip(),
        "room_type": data.get("room_type"),
        "floor_level": int(data.get("floor_level", 1)),
        "length_m": float(data["length_m"]),
        "width_m": float(data["width_m"]),
        "height_m": float(data.get("height_m", 2.7)),
        "openings_sq_m": float(data.get("openings_sq_m", 2)),
        "outlets_count": int(data.get("outlets_count", 0)),
        "switches_count": int(data.get("switches_count", 0)),
        "plumbing_points": int(data.get("plumbing_points", 0)),
        "notes": data.get("notes"),
        "budget_alert_pct": data.get("budget_alert_pct"),
    }


def _direct_patch(data: dict) -> dict:
    """Preserve the current API contract for explicit null values."""
    return {
        field: value
        for field, value in data.items()
        if value is not None or field in _DIRECT_NULLABLE_FIELDS
    }


async def _room_amounts(db: AsyncSession, room_id: str) -> tuple[float, float]:
    planned, actual = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(EstimateLine.quantity_planned * EstimateLine.unit_price),
                    0,
                ),
                func.coalesce(
                    func.sum(EstimateLine.quantity_actual * EstimateLine.unit_price),
                    0,
                ),
            ).where(EstimateLine.room_id == room_id)
        )
    ).one()
    return float(planned or 0), float(actual or 0)


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    room: Room,
    actor_id: str,
    action: str,
    changes: dict[str, dict[str, object]],
) -> None:
    created = action == "create"
    changed_fields = ", ".join(sorted(changes))
    activity_title = (
        f"Добавлена комната: {room.name}"
        if created
        else f"Обновлена комната: {room.name}"
    )
    activity_body = None if created else (changed_fields or "Без изменений")
    await outbox.enqueue(
        db,
        aggregate_type="room",
        aggregate_id=room.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": "RoomCreated" if created else "RoomUpdated",
            "title": activity_title,
            "body": activity_body,
            "room_id": room.id,
            "link_path": f"/room/{room.id}",
        },
    )

    customer_id = project.customer_id
    if customer_id and customer_id != actor_id:
        await outbox.enqueue(
            db,
            aggregate_type="room",
            aggregate_id=room.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": customer_id,
                "project_id": project.id,
                "notification_type": "room_created" if created else "room_updated",
                "title": "Новая комната" if created else "Обновлена комната",
                "body": room.name if created else f"{room.name}: {changed_fields}",
                "link_path": f"/room/{room.id}",
                "return_to": "/(customer)/(tabs)/object?tab=rooms",
            },
        )

        if not created:
            planned, actual = await _room_amounts(db, room.id)
            if planned > 0 and actual > planned:
                await outbox.enqueue(
                    db,
                    aggregate_type="room",
                    aggregate_id=room.id,
                    event_type=outbox.NOTIFICATION_EVENT,
                    payload={
                        "user_id": customer_id,
                        "project_id": project.id,
                        "notification_type": "change_order",
                        "title": "Превышение бюджета комнаты",
                        "body": f"{room.name}: +{actual - planned:.2f} ₽",
                        "link_path": f"/room/{room.id}",
                        "return_to": "/(customer)/(tabs)/object?tab=rooms",
                    },
                )


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def create_room(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    data: dict,
    client_request_id: str | None = None,
) -> RoomMutationResult:
    """Create one room exactly once with estimates, budget and evidence."""
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )

    await _require_direct_editor(db, project=project, actor=actor)
    project_id = project.id
    actor_id = actor.id
    payload = _create_payload(data)

    try:
        replay_id = await replay_entity_id(
            db,
            scope=ROOM_CREATE_SCOPE,
            project_id=project_id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
        )
    except IdempotencyConflict:
        raise
    if replay_id:
        existing = (
            await db.execute(
                select(Room).where(
                    Room.id == replay_id,
                    Room.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ValueError("idempotency_entity_missing")
        return RoomMutationResult(existing, True, {})

    room = await room_service.prepare_room(
        db,
        project=project,
        data=payload,
    )
    await _prepare_effects(
        db,
        project=project,
        room=room,
        actor_id=actor_id,
        action="create",
        changes={},
    )
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=ROOM_CREATE_SCOPE,
            project_id=project_id,
            user_id=actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=room.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        existing = (
            await db.execute(
                select(Room).where(
                    Room.id == entity_id,
                    Room.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ValueError("idempotency_entity_missing")
        return RoomMutationResult(existing, True, {})

    await db.refresh(room)
    await _dispatch(db, "room.create")
    return RoomMutationResult(room, False, {})


async def update_room(
    db: AsyncSession,
    *,
    project: Project,
    room_id: str,
    actor: User,
    data: dict,
) -> RoomMutationResult | None:
    """Update a project room once and commit every derived projection atomically."""
    await _require_direct_editor(db, project=project, actor=actor)
    query = select(Room).where(
        Room.id == room_id,
        Room.project_id == project.id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    room = (await db.execute(query)).scalar_one_or_none()
    if room is None:
        return None

    patch = _direct_patch(data)
    if not patch:
        await db.commit()
        return RoomMutationResult(room, True, {})

    try:
        changes = await room_service.apply_room_patch(
            db,
            room,
            patch,
            user_id=actor.id,
            allow_archive=True,
        )
        if not changes:
            await db.commit()
            return RoomMutationResult(room, True, {})
        await room_service.sync_room_estimate_lines(db, room, commit=False)
        await _prepare_effects(
            db,
            project=project,
            room=room,
            actor_id=actor.id,
            action="update",
            changes=changes,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(room)
    await _dispatch(db, "room.update")
    return RoomMutationResult(room, False, changes)
