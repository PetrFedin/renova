from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, WasteOrder, WasteOrderStatus, UserRole
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["waste"])

class WasteIn(BaseModel):
    room_id: str | None = None
    volume_m3: float = 1
    waste_type: str = "construction"
    scheduled_date: date | None = None
    price: float = 0
    notes: str | None = None

def _out(w: WasteOrder) -> dict:
    return {"id": w.id, "room_id": w.room_id, "volume_m3": w.volume_m3, "waste_type": w.waste_type, "scheduled_date": w.scheduled_date.isoformat() if w.scheduled_date else None, "status": w.status.value, "price": w.price, "notes": w.notes, "total": round(w.volume_m3 * w.price, 2) if w.price else 0}

@router.get("/{project_id}/waste-orders")
async def list_waste(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id).order_by(WasteOrder.created_at.desc()))
    return [_out(w) for w in r.scalars().all()]

@router.post("/{project_id}/waste-orders")
async def create_waste(project_id: str, body: WasteIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    w = WasteOrder(project_id=project_id, **body.model_dump())
    db.add(w); await db.commit(); await db.refresh(w)
    return _out(w)

@router.post("/{project_id}/waste-orders/{order_id}/request")
async def request_waste(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    w = await db.get(WasteOrder, order_id)
    if not w or w.project_id != project_id: raise HTTPException(404)
    w.status = WasteOrderStatus.requested
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"Вывоз мусора {w.volume_m3} м³", body=w.notes, room_id=w.room_id, link_path="/approvals")
    return _out(w)

@router.post("/{project_id}/waste-orders/{order_id}/approve")
async def approve_waste(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer: raise HTTPException(403)
    w = await db.get(WasteOrder, order_id)
    if not w or w.project_id != project_id: raise HTTPException(404)
    w.status = WasteOrderStatus.scheduled
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"Вывоз согласован", room_id=w.room_id)
    return _out(w)

@router.post("/{project_id}/waste-orders/{order_id}/complete")
async def complete_waste(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    w = await db.get(WasteOrder, order_id)
    if not w or w.project_id != project_id: raise HTTPException(404)
    w.status = WasteOrderStatus.done
    await db.commit()
    return _out(w)
