"""Room-change requests with scoped patches and durable decision evidence."""
from __future__ import annotations

import json
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    Project,
    Room,
    RoomChangeRequest,
    RoomChangeStatus,
    User,
)
from app.services import outbox_service as outbox
from app.services import room_service
from app.services import team_service

RoomDecision = Literal["approve", "reject"]


def _target(decision: RoomDecision) -> RoomChangeStatus:
    return (
        RoomChangeStatus.approved
        if decision == "approve"
        else RoomChangeStatus.rejected
    )


async def _validate_actor(db: AsyncSession, project: Project, actor: User) -> None:
    role = await team_service.team_role_for_project(db, actor, project)
    if role not in {"owner", "foreman"}:
        raise ValueError("room_change_actor_forbidden")


def _payload(request: RoomChangeRequest) -> dict:
    if not request.payload_json:
        return {}
    try:
        parsed = json.loads(request.payload_json)
    except (TypeError, ValueError) as error:
        raise ValueError("room_change_payload_invalid") from error
    if not isinstance(parsed, dict):
        raise ValueError("room_change_payload_invalid")
    return parsed


async def create_request(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    room_id: str,
    message: str,
    payload: dict | None = None,
) -> RoomChangeRequest:
    """Create a project-scoped request and notify assigned executors atomically."""
    if actor.id != project.customer_id:
        raise ValueError("room_change_customer_required")
    room = (
        await db.execute(
            select(Room).where(Room.id == room_id, Room.project_id == project.id)
        )
    ).scalar_one_or_none()
    if room is None:
        raise ValueError("room_change_room_not_found")
    normalized_message = (message or "").strip()
    if not normalized_message:
        raise ValueError("room_change_message_required")
    if len(normalized_message) > 4000:
        raise ValueError("room_change_message_too_long")
    normalized_payload = None
    if payload is not None:
        normalized_payload = room_service.validate_room_patch(payload)

    request = RoomChangeRequest(
        project_id=project.id,
        room_id=room.id,
        requested_by=actor.id,
        message=normalized_message,
        payload_json=(
            json.dumps(normalized_payload, ensure_ascii=False)
            if normalized_payload is not None
            else None
        ),
        status=RoomChangeStatus.pending,
    )
    db.add(request)
    await db.flush()
    await outbox.enqueue(
        db,
        aggregate_type="room_change_request",
        aggregate_id=request.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor.id,
            "kind": "RoomChangeRequested",
            "title": f"Запрошено изменение комнаты: {room.name}",
            "body": normalized_message,
            "room_id": room.id,
            "link_path": f"/room/{room.id}",
        },
    )
    for recipient_id in sorted(
        value
        for value in {project.contractor_id}
        if value and value != actor.id
    ):
        await outbox.enqueue(
            db,
            aggregate_type="room_change_request",
            aggregate_id=request.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": recipient_id,
                "project_id": project.id,
                "notification_type": "room_change",
                "title": "Запрос на изменение комнаты",
                "body": normalized_message[:500],
                "link_path": "/(contractor)/(tabs)/object?tab=rooms",
                "return_to": "/(contractor)/(tabs)/home",
            },
        )
    try:
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(request)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="room_change.create", limit=10)
    return request


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    request: RoomChangeRequest,
    room: Room,
    actor_id: str,
    decision: RoomDecision,
    reason: str | None,
    changes: dict[str, dict[str, object]],
) -> None:
    approved = decision == "approve"
    title = (
        f"Изменение комнаты согласовано: {room.name}"
        if approved
        else f"Изменение комнаты отклонено: {room.name}"
    )
    body = (reason or "").strip() or request.message
    await outbox.enqueue(
        db,
        aggregate_type="room_change_request",
        aggregate_id=request.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": "RoomChangeApproved" if approved else "RoomChangeRejected",
            "title": title,
            "body": body,
            "room_id": room.id,
            "link_path": f"/room/{room.id}",
        },
    )
    if project.customer_id and project.customer_id != actor_id:
        change_count = len(changes)
        notification_body = body
        if approved and change_count:
            notification_body = f"Применено изменений: {change_count}. {body}"
        await outbox.enqueue(
            db,
            aggregate_type="room_change_request",
            aggregate_id=request.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project.id,
                "notification_type": "room_change",
                "title": title,
                "body": notification_body,
                "link_path": f"/room/{room.id}",
                "return_to": "/(customer)/(tabs)/object?tab=rooms",
            },
        )


async def decide_request(
    db: AsyncSession,
    *,
    project: Project,
    request_id: str,
    actor: User,
    decision: RoomDecision,
    reason: str | None = None,
) -> tuple[RoomChangeRequest | None, Room | None, bool, dict[str, dict[str, object]]]:
    """Resolve one request exactly once and atomically apply its approved patch."""
    await _validate_actor(db, project, actor)
    query = select(RoomChangeRequest).where(
        RoomChangeRequest.id == request_id,
        RoomChangeRequest.project_id == project.id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    request = (await db.execute(query)).scalar_one_or_none()
    if request is None:
        return None, None, False, {}

    target = _target(decision)
    current = (
        request.status
        if isinstance(request.status, RoomChangeStatus)
        else RoomChangeStatus(str(request.status))
    )
    room = (
        await db.execute(
            select(Room).where(
                Room.id == request.room_id,
                Room.project_id == project.id,
            )
        )
    ).scalar_one_or_none()
    if room is None:
        raise ValueError("room_change_room_not_found")

    if current == target:
        return request, room, True, {}
    if current != RoomChangeStatus.pending:
        raise ValueError("room_change_final_state_conflict")

    changes: dict[str, dict[str, object]] = {}
    try:
        if decision == "approve":
            patch = _payload(request)
            if patch:
                changes = await room_service.apply_room_patch(
                    db,
                    room,
                    patch,
                    user_id=actor.id,
                )
                await room_service.sync_room_estimate_lines(
                    db,
                    room,
                    commit=False,
                )
        request.status = target
        request.resolved_at = utc_now()
        await _prepare_effects(
            db,
            project=project,
            request=request,
            room=room,
            actor_id=actor.id,
            decision=decision,
            reason=reason,
            changes=changes,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(request)
    await db.refresh(room)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source=f"room_change.{decision}",
        limit=10,
    )
    return request, room, False, changes
