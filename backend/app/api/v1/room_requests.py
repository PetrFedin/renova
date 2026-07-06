"""Запросы заказчика на изменение комнат."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import RoomChangeRequest, RoomChangeStatus, User, UserRole
from app.services import notification_service as notif_svc
from app.services import project_service as proj_svc
from app.services import room_service as room_svc

router = APIRouter(prefix="/projects", tags=["room-requests"])


class RoomChangeCreate(BaseModel):
    room_id: str
    message: str = Field(min_length=1)
    payload: dict | None = None


@router.get("/{project_id}/room-change-requests")
async def list_requests(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(RoomChangeRequest).where(RoomChangeRequest.project_id == project_id).order_by(RoomChangeRequest.created_at.desc()))
    items = r.scalars().all()
    return [
        {
            "id": x.id,
            "room_id": x.room_id,
            "status": x.status.value,
            "message": x.message,
            "payload": json.loads(x.payload_json) if x.payload_json else None,
            "created_at": x.created_at.isoformat(),
        }
        for x in items
    ]


@router.post("/{project_id}/room-change-requests")
async def create_request(project_id: str, body: RoomChangeCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer:
        raise HTTPException(403, "Заказчик создаёт запрос")
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404)
    req = RoomChangeRequest(
        project_id=project_id,
        room_id=body.room_id,
        requested_by=user.id,
        message=body.message,
        payload_json=json.dumps(body.payload) if body.payload else None,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    if p.contractor_id:
        await notif_svc.notify(
            db,
            user_id=p.contractor_id,
            project_id=project_id,
            notification_type="room_change",
            title="Запрос на изменение комнаты",
            body=body.message[:200],
            link_path="/(contractor)/(tabs)/rooms", return_to="/(contractor)/(tabs)/objects",
        )
    return {"id": req.id, "status": req.status.value}


@router.post("/{project_id}/room-change-requests/{req_id}/approve")
async def approve_request(project_id: str, req_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    r = await db.get(RoomChangeRequest, req_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404)
    if r.payload_json:
        patch = json.loads(r.payload_json)
        await room_svc.update_room(db, r.room_id, patch)
    r.status = RoomChangeStatus.approved
    r.resolved_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/{project_id}/room-change-requests/{req_id}/reject")
async def reject_request(project_id: str, req_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    r = await db.get(RoomChangeRequest, req_id)
    if not r or r.project_id != project_id:
        raise HTTPException(404)
    r.status = RoomChangeStatus.rejected
    r.resolved_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}
