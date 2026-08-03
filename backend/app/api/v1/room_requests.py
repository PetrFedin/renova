"""Запросы заказчика на изменение комнат."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, RoomChangeRequest, User
from app.services import room_change_service as request_svc

router = APIRouter(prefix="/projects", tags=["room-requests"])


class RoomChangeCreate(BaseModel):
    room_id: str
    message: str = Field(min_length=1, max_length=4000)
    payload: dict | None = None


def _payload_json(request: RoomChangeRequest) -> dict | None:
    if not request.payload_json:
        return None
    try:
        value = json.loads(request.payload_json)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _request_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {"room_change_customer_required", "room_change_actor_forbidden"}:
        return HTTPException(
            403,
            detail={"code": code, "message": "Действие недоступно для вашей роли в проекте"},
        )
    if code in {"room_change_room_not_found"}:
        return HTTPException(404, detail={"code": code})
    if code == "room_change_final_state_conflict":
        return HTTPException(
            409,
            detail={"code": code, "message": "Запрос уже закрыт другим решением"},
        )
    if code.startswith("room_patch_") or code in {
        "room_change_payload_invalid",
        "room_change_message_required",
        "room_change_message_too_long",
    }:
        return HTTPException(422, detail={"code": code})
    return HTTPException(409, detail={"code": code})


@router.get("/{project_id}/room-change-requests")
async def list_requests(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    result = await db.execute(
        select(RoomChangeRequest)
        .where(RoomChangeRequest.project_id == project_id)
        .order_by(RoomChangeRequest.created_at.desc())
    )
    return [
        {
            "id": request.id,
            "room_id": request.room_id,
            "status": request.status.value if hasattr(request.status, "value") else str(request.status),
            "message": request.message,
            "payload": _payload_json(request),
            "created_at": request.created_at.isoformat(),
            "resolved_at": request.resolved_at.isoformat() if request.resolved_at else None,
        }
        for request in result.scalars().all()
    ]


@router.post("/{project_id}/room-change-requests")
async def create_request(
    project_id: str,
    body: RoomChangeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project: Project = await require_project(db, project_id, user, write=True)
    try:
        request = await request_svc.create_request(
            db,
            project=project,
            actor=user,
            room_id=body.room_id,
            message=body.message,
            payload=body.payload,
        )
    except ValueError as error:
        raise _request_error(error) from error
    return {
        "id": request.id,
        "status": request.status.value if hasattr(request.status, "value") else str(request.status),
        "replayed": False,
    }


async def _decide(
    *,
    project_id: str,
    request_id: str,
    decision: request_svc.RoomDecision,
    user: User,
    db: AsyncSession,
) -> dict:
    project: Project = await require_project(db, project_id, user, write=True)
    try:
        request, room, replayed, changes = await request_svc.decide_request(
            db,
            project=project,
            request_id=request_id,
            actor=user,
            decision=decision,
        )
    except ValueError as error:
        raise _request_error(error) from error
    if request is None:
        raise HTTPException(404, detail={"code": "room_change_request_not_found"})
    return {
        "ok": True,
        "id": request.id,
        "status": request.status.value if hasattr(request.status, "value") else str(request.status),
        "room_id": room.id if room else request.room_id,
        "changes": changes,
        "replayed": replayed,
    }


@router.post("/{project_id}/room-change-requests/{req_id}/approve")
async def approve_request(
    project_id: str,
    req_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _decide(
        project_id=project_id,
        request_id=req_id,
        decision="approve",
        user=user,
        db=db,
    )


@router.post("/{project_id}/room-change-requests/{req_id}/reject")
async def reject_request(
    project_id: str,
    req_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _decide(
        project_id=project_id,
        request_id=req_id,
        decision="reject",
        user=user,
        db=db,
    )
