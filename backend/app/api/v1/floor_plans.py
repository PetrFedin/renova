from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, FloorPlan, FloorPlanPin, FurnitureItem, Room
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["floor-plans"])

class PlanIn(BaseModel):
    name: str = "Планировка"
    floor_level: int = 1
    image_key: str
    width_px: int | None = None
    height_px: int | None = None

class PinPatch(BaseModel):
    x_pct: float
    y_pct: float

class PinIn(BaseModel):
    room_id: str
    x_pct: float = 50
    y_pct: float = 50
    label: str | None = None

class FurnitureIn(BaseModel):
    room_id: str | None = None
    floor_plan_id: str | None = None
    name: str
    width_m: float = 0.6
    depth_m: float = 0.6
    height_m: float = 0.8
    x_pct: float | None = None
    y_pct: float | None = None
    notes: str | None = None

def _plan(p: FloorPlan, pins: list) -> dict:
    return {"id": p.id, "name": p.name, "image_key": p.image_key, "image_url": f"/api/v1/media/{p.image_key}", "width_px": p.width_px, "height_px": p.height_px, "floor_level": getattr(p, "floor_level", 1), "pins": pins, "created_at": p.created_at.isoformat()}

@router.get("/{project_id}/floor-plans")
async def list_plans(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(select(FloorPlan).where(FloorPlan.project_id == project_id).order_by(FloorPlan.created_at.desc()))
    out = []
    for p in r.scalars().all():
        pr = await db.execute(select(FloorPlanPin).where(FloorPlanPin.floor_plan_id == p.id))
        pins = [{"id": x.id, "room_id": x.room_id, "x_pct": x.x_pct, "y_pct": x.y_pct, "label": x.label} for x in pr.scalars().all()]
        out.append(_plan(p, pins))
    return out

@router.post("/{project_id}/floor-plans")
async def create_plan(project_id: str, body: PlanIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    p = FloorPlan(project_id=project_id, **body.model_dump())
    db.add(p); await db.commit(); await db.refresh(p)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="plan", title=f"Планировка: {p.name}", link_path="/approvals")
    return _plan(p, [])

@router.post("/{project_id}/floor-plans/{plan_id}/pins")
async def upsert_pin(project_id: str, plan_id: str, body: PinIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    plan = await db.get(FloorPlan, plan_id)
    if not plan or plan.project_id != project_id: raise HTTPException(404)
    room = await db.get(Room, body.room_id)
    if not room or room.project_id != project_id: raise HTTPException(400, "room not in project")
    r = await db.execute(select(FloorPlanPin).where(FloorPlanPin.floor_plan_id == plan_id, FloorPlanPin.room_id == body.room_id))
    pin = r.scalar_one_or_none()
    if pin:
        pin.x_pct, pin.y_pct, pin.label = body.x_pct, body.y_pct, body.label
    else:
        pin = FloorPlanPin(floor_plan_id=plan_id, **body.model_dump())
        db.add(pin)
    await db.commit(); await db.refresh(pin)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="room_change", title=f"Метка комнаты на плане", room_id=body.room_id, link_path=f"/room/{body.room_id}")
    return {"id": pin.id, "room_id": pin.room_id, "x_pct": pin.x_pct, "y_pct": pin.y_pct, "label": pin.label}

@router.get("/{project_id}/furniture")
async def list_furniture(project_id: str, room_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    q = select(FurnitureItem).where(FurnitureItem.project_id == project_id)
    if room_id: q = q.where(FurnitureItem.room_id == room_id)
    r = await db.execute(q.order_by(FurnitureItem.created_at.desc()))
    return [{"id": f.id, "room_id": f.room_id, "floor_plan_id": f.floor_plan_id, "name": f.name, "width_m": f.width_m, "depth_m": f.depth_m, "height_m": f.height_m, "x_pct": f.x_pct, "y_pct": f.y_pct, "notes": f.notes} for f in r.scalars().all()]

@router.post("/{project_id}/furniture")
async def create_furniture(project_id: str, body: FurnitureIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    f = FurnitureItem(project_id=project_id, **body.model_dump())
    db.add(f); await db.commit(); await db.refresh(f)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="plan", title=f"Мебель: {f.name}", room_id=f.room_id)
    return {"id": f.id, "name": f.name, "width_m": f.width_m, "depth_m": f.depth_m, "height_m": f.height_m, "x_pct": f.x_pct, "y_pct": f.y_pct}

@router.patch("/{project_id}/floor-plans/{plan_id}/pins/{pin_id}")
async def move_pin(project_id: str, plan_id: str, pin_id: str, body: PinPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    pin = await db.get(FloorPlanPin, pin_id)
    if not pin: raise HTTPException(404)
    pin.x_pct, pin.y_pct = body.x_pct, body.y_pct
    await db.commit()
    return {"id": pin.id, "x_pct": pin.x_pct, "y_pct": pin.y_pct}

class FurnitureMove(BaseModel):
    x_pct: float
    y_pct: float

@router.patch("/{project_id}/furniture/{item_id}")
async def move_furniture(project_id: str, item_id: str, body: FurnitureMove, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    f = await db.get(FurnitureItem, item_id)
    if not f or f.project_id != project_id: raise HTTPException(404)
    f.x_pct, f.y_pct = body.x_pct, body.y_pct
    await db.commit()
    return {"ok": True, "x_pct": f.x_pct, "y_pct": f.y_pct}
