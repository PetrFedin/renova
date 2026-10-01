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
ROOM_CHANGE_CREATE_SCOPE = "room_change.create"
_CONTRACTOR_ROOMS_PATH = "/(contractor)/(tabs)/object?tab=rooms"
_CUSTOMER_ROOMS_PATH = "/(customer)/(tabs)/object?tab=rooms"


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
    room_id: str | None,
    message: str,
    payload: dict | None = None,
    client_request_id: str | None = None,
) -> tuple[RoomChangeRequest, bool]:
    """Create a project-scoped request and notify assigned executors atomically.

    #436: same `client_request_id` + same canonical payload replays the
    existing request instead of creating a second one (commit-then-response-
    loss safe); same id + a different payload raises `IdempotencyConflict`.
    A new id always creates a distinct request, even for an identical
    room/message/payload — payload equality is never treated as intent
    identity.

    QLT-007: `room_id=None` is an "add a room" request — `payload` carries the
    new room (name, type, sizes); the executor's approval creates it.
    QLT-009: with no executor linked nobody can decide, so creation is a 409
    (`room_change_no_contractor`); the customer edits/creates directly then.
    """
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )

    if actor.id != project.customer_id:
        raise ValueError("room_change_customer_required")
    if project.contractor_id is None:
        raise ValueError("room_change_no_contractor")
    room = None
    if room_id is not None:
        room = (
            await db.execute(
                select(Room).where(Room.id == room_id, Room.project_id == project.id)
            )
        ).scalar_one_or_none()
        if room is None:
            raise ValueError("room_change_room_not_found")
    elif payload is None:
        raise ValueError("room_patch_empty")
    normalized_message = (message or "").strip()
    if not normalized_message:
        raise ValueError("room_change_message_required")
    if len(normalized_message) > 4000:
        raise ValueError("room_change_message_too_long")
    normalized_payload = None
    if payload is not None:
        normalized_payload = (
            room_service.validate_room_patch(payload)
            if room is not None
            else room_service.validate_room_create(payload)
        )

    room_label = room.name if room is not None else str(normalized_payload["name"])
    canonical_payload = {
        "room_id": room.id if room is not None else None,
        "message": normalized_message,
        "payload": normalized_payload,
    }

    try:
        replay_id = await replay_entity_id(
            db,
            scope=ROOM_CHANGE_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor.id,
            request_id=client_request_id,
            payload=canonical_payload,
        )
    except IdempotencyConflict:
        raise
    if replay_id:
        existing = (
            await db.execute(
                select(RoomChangeRequest).where(
                    RoomChangeRequest.id == replay_id,
                    RoomChangeRequest.project_id == project.id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ValueError("idempotency_entity_missing")
        return existing, True

    request = RoomChangeRequest(
        project_id=project.id,
        room_id=room.id if room is not None else None,
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
            "title": (
                f"Запрошено изменение комнаты: {room.name}"
                if room is not None
                else f"Запрошено добавление комнаты: {room_label}"
            ),
            "body": normalized_message,
            "room_id": room.id if room is not None else None,
            "link_path": f"/room/{room.id}" if room is not None else _CONTRACTOR_ROOMS_PATH,
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
                "title": (
                    "Запрос на изменение комнаты"
                    if room is not None
                    else f"Запрос на добавление комнаты: {room_label}"
                ),
                "body": normalized_message[:500],
                "link_path": "/(contractor)/(tabs)/object?tab=rooms",
                "return_to": "/(contractor)/(tabs)/",
            },
        )
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=ROOM_CHANGE_CREATE_SCOPE,
            project_id=project.id,
            user_id=actor.id,
            request_id=client_request_id,
            payload=canonical_payload,
            entity_id=request.id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        existing = (
            await db.execute(
                select(RoomChangeRequest).where(
                    RoomChangeRequest.id == entity_id,
                    RoomChangeRequest.project_id == project.id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ValueError("idempotency_entity_missing")
        return existing, True

    await db.refresh(request)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="room_change.create", limit=10)
    return request, False


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    request: RoomChangeRequest,
    room: Room | None,
    actor_id: str,
    decision: RoomDecision,
    reason: str | None,
    changes: dict[str, dict[str, object]],
) -> None:
    approved = decision == "approve"
    add_room = request.room_id is None
    label = room.name if room is not None else str(_payload(request).get("name") or "")
    if add_room:
        title = (
            f"Добавление комнаты согласовано: {label}"
            if approved
            else f"Добавление комнаты отклонено: {label}"
        )
    else:
        title = (
            f"Изменение комнаты согласовано: {label}"
            if approved
            else f"Изменение комнаты отклонено: {label}"
        )
    link_path = f"/room/{room.id}" if room is not None else _CUSTOMER_ROOMS_PATH
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
            "room_id": room.id if room is not None else None,
            "link_path": link_path,
        },
    )
    if project.customer_id and project.customer_id != actor_id:
        change_count = len(changes)
        notification_body = body
        if approved and add_room:
            notification_body = f"Комната создана. {body}"
        elif approved and change_count:
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
                "link_path": link_path,
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
    add_room = request.room_id is None
    lookup_id = request.created_room_id if add_room else request.room_id
    room = None
    if lookup_id is not None:
        room = (
            await db.execute(
                select(Room).where(
                    Room.id == lookup_id,
                    Room.project_id == project.id,
                )
            )
        ).scalar_one_or_none()
    if room is None and not add_room:
        raise ValueError("room_change_room_not_found")

    if current == target:
        return request, room, True, {}
    if current != RoomChangeStatus.pending:
        raise ValueError("room_change_final_state_conflict")

    changes: dict[str, dict[str, object]] = {}
    try:
        if decision == "approve":
            patch = _payload(request)
            if add_room:
                # Idempotent: the row is locked and only `pending` reaches here,
                # so the room is created exactly once. A locked estimate keeps
                # its lines/budget (prepare_room -> sync_room_estimate_lines).
                if not patch:
                    raise ValueError("room_change_payload_invalid")
                room = await room_service.prepare_room(
                    db,
                    project=project,
                    data=room_service.validate_room_create(patch),
                )
                request.created_room_id = room.id
                changes = {"room_created": {"old": None, "new": room.id}}
            elif patch:
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
    if room is not None:
        await db.refresh(room)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source=f"room_change.{decision}",
        limit=10,
    )
    return request, room, False, changes
