"""Project room API backed by one canonical mutation lifecycle."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Room, RoomChangeLog, User
from app.schemas.project import RoomInput, RoomOut, RoomUpdate
from app.services import room_mutation_service as mutations
from app.services import room_service

router = APIRouter(prefix="/projects", tags=["rooms"])


class RoomCreateIn(RoomInput):
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


def _mutation_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code == "room_direct_editor_forbidden":
        return HTTPException(
            403,
            detail={
                "code": code,
                "message": "Заказчик отправляет изменения через запрос комнаты; напрямую редактирует исполнитель",
            },
        )
    if code == "idempotency_conflict":
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Идентификатор запроса уже использован для другой комнаты",
            },
        )
    if code == "idempotency_entity_missing":
        return HTTPException(409, detail={"code": code})
    if code.startswith("room_patch_"):
        return HTTPException(
            422,
            detail={"code": code, "message": "Некорректные параметры комнаты"},
        )
    return HTTPException(409, detail={"code": code, "message": "Изменение комнаты недоступно"})


@router.get("/{project_id}/rooms", response_model=list[RoomOut])
async def list_rooms(
    project_id: str,
    archived: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    return [
        room_service.room_detail(room)
        for room in project.rooms
        if bool(getattr(room, "is_archived", False)) == archived
    ]


@router.patch("/{project_id}/rooms/{room_id}", response_model=RoomOut)
async def update_room(
    project_id: str,
    room_id: str,
    body: RoomUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_room(
            db,
            project=project,
            room_id=room_id,
            actor=user,
            data=body.model_dump(exclude_unset=True),
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, "Комната не найдена")
    return room_service.room_detail(result.room)


@router.get("/{project_id}/rooms/{room_id}/change-log")
async def room_change_log(
    project_id: str,
    room_id: str,
    field: str | None = None,
    since: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    room_exists = await db.scalar(
        select(Room.id).where(
            Room.id == room_id,
            Room.project_id == project_id,
        )
    )
    if room_exists is None:
        raise HTTPException(404, "Комната не найдена")

    query = select(RoomChangeLog).where(RoomChangeLog.room_id == room_id)
    if field:
        query = query.where(RoomChangeLog.field_name == field)
    if since:
        try:
            since_at = datetime.fromisoformat(since)
        except ValueError as error:
            raise HTTPException(
                422,
                detail={"code": "room_change_log_since_invalid"},
            ) from error
        query = query.where(RoomChangeLog.created_at >= since_at)
    result = await db.execute(
        query.order_by(RoomChangeLog.created_at.desc()).limit(50)
    )
    return [
        {
            "field": item.field_name,
            "old": item.old_value,
            "new": item.new_value,
            "at": item.created_at.isoformat(),
        }
        for item in result.scalars().all()
    ]


@router.post("/{project_id}/rooms", response_model=RoomOut)
async def create_room_route(
    project_id: str,
    body: RoomCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.create_room(
            db,
            project=project,
            actor=user,
            data=body.model_dump(exclude={"client_request_id"}),
            client_request_id=body.client_request_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    return room_service.room_detail(result.room)
