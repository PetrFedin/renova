"""API комнат: габариты, розетки, сантехника."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.schemas.project import RoomInput, RoomOut, RoomUpdate
from app.services import room_service as room_svc

router = APIRouter(prefix="/projects", tags=["rooms"])


@router.get("/{project_id}/rooms", response_model=list[RoomOut])
async def list_rooms(project_id: str, archived: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    return [room_svc.room_detail(r) for r in p.rooms if bool(getattr(r, "is_archived", False)) == archived]


@router.patch("/{project_id}/rooms/{room_id}", response_model=RoomOut)
async def update_room(
    project_id: str,
    room_id: str,
    body: RoomUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await require_project(db, project_id, user, write=True)
    if not any(r.id == room_id for r in p.rooms):
        raise HTTPException(404, "Комната не найдена")
    room = await room_svc.update_room(db, room_id, body.model_dump(exclude_unset=True), user.id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    return room_svc.room_detail(room)

@router.get("/{project_id}/rooms/{room_id}/change-log")
async def room_change_log(project_id: str, room_id: str, field: str | None = None, since: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    from sqlalchemy import select
    from app.models.entities import RoomChangeLog
    q = select(RoomChangeLog).where(RoomChangeLog.room_id == room_id)
    if field: q = q.where(RoomChangeLog.field_name == field)
    if since:
        from datetime import datetime as dt
        q = q.where(RoomChangeLog.created_at >= dt.fromisoformat(since))
    r = await db.execute(q.order_by(RoomChangeLog.created_at.desc()).limit(50))
    return [{"field": x.field_name, "old": x.old_value, "new": x.new_value, "at": x.created_at.isoformat()} for x in r.scalars().all()]

@router.post("/{project_id}/rooms", response_model=RoomOut)
async def create_room_route(
    project_id: str,
    body: RoomInput,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.entities import UserRole
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель добавляет комнаты")
    room = await room_svc.create_room(db, project_id, body.model_dump(), user.id)
    if not room:
        raise HTTPException(404, "Проект не найден")
    return room_svc.room_detail(room)

