"""Exactly-once RoomChangeRequest creation with atomic outbox evidence."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.api.v1.room_requests import _request_error
from app.db.session import get_db
from app.models.entities import Project, RoomChangeRequest, User
from app.services import room_change_service as request_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(prefix="/projects", tags=["room-requests"])
ROOM_CHANGE_CREATE_SCOPE = "room_change.create"


class RoomChangeCreateCommand(BaseModel):
    room_id: str
    message: str = Field(min_length=1, max_length=4000)
    payload: dict | None = None
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


def _conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос изменения комнаты уже использован с другими данными",
        },
    )


def _result(request: RoomChangeRequest, *, replayed: bool) -> dict:
    return {
        "id": request.id,
        "status": request.status.value if hasattr(request.status, "value") else str(request.status),
        "replayed": replayed,
    }


@router.post("/{project_id}/room-change-requests")
async def create_room_change_request_integrity(
    project_id: str,
    body: RoomChangeCreateCommand,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project: Project = await require_project(db, project_id, user, write=True)
    # Authorization must be checked before a replay lookup: a request ID is not
    # an authority token.
    if user.id != project.customer_id:
        raise _request_error(ValueError("room_change_customer_required"))

    payload = {
        "room_id": body.room_id,
        "message": body.message.strip(),
        "payload": body.payload,
    }
    try:
        replay_id = await replay_entity_id(
            db,
            scope=ROOM_CHANGE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _conflict() from exc

    if replay_id:
        request = await db.get(RoomChangeRequest, replay_id)
        if not request or request.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _result(request, replayed=True)

    try:
        request = await request_svc.create_request(
            db,
            project=project,
            actor=user,
            room_id=body.room_id,
            message=body.message,
            payload=body.payload,
            commit=False,
        )
    except ValueError as error:
        raise _request_error(error) from error

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=ROOM_CHANGE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=request.id,
        )
    except IdempotencyConflict as exc:
        raise _conflict() from exc

    if not created:
        canonical = await db.get(RoomChangeRequest, entity_id)
        if not canonical or canonical.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _result(canonical, replayed=True)

    await db.refresh(request)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="room_change.create", limit=10)
    return _result(request, replayed=False)
