from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, MaterialPick, MaterialPickStatus, UserRole
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["materials"])

class PickIn(BaseModel):
    name: str
    room_id: str | None = None
    qty: float = 1
    unit: str = "шт"
    price: float = 0
    shop_url: str | None = None
    shop_name: str | None = None
    work_type: str | None = None
    analog_of_id: str | None = None
    notes: str | None = None

def _out(p: MaterialPick) -> dict:
    return {"id": p.id, "name": p.name, "room_id": p.room_id, "qty": p.qty, "unit": p.unit, "price": p.price, "shop_url": p.shop_url, "shop_name": p.shop_name, "work_type": p.work_type, "status": p.status.value, "analog_of_id": p.analog_of_id, "notes": p.notes, "total": round(p.qty * p.price, 2)}

@router.get("/{project_id}/material-picks")
async def list_picks(project_id: str, work_type: str | None = None, status: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    q = select(MaterialPick).where(MaterialPick.project_id == project_id)
    if work_type: q = q.where(MaterialPick.work_type == work_type)
    if status: q = q.where(MaterialPick.status == status)
    r = await db.execute(q.order_by(MaterialPick.created_at.desc()))
    return [_out(p) for p in r.scalars().all()]

@router.post("/{project_id}/material-picks")
async def create_pick(project_id: str, body: PickIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    p = MaterialPick(project_id=project_id, **body.model_dump())
    db.add(p); await db.commit(); await db.refresh(p)
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="material", title=f"Материал: {p.name}", body=p.shop_url, room_id=p.room_id, work_type=p.work_type, link_path="/(customer)/(tabs)/estimate")
    return _out(p)

@router.post("/{project_id}/material-picks/{pick_id}/submit")
async def submit_pick(project_id: str, pick_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    p = await db.get(MaterialPick, pick_id)
    if not p or p.project_id != project_id: raise HTTPException(404)
    p.status = MaterialPickStatus.pending
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"На согласовании: {p.name}", work_type=p.work_type)
    from app.services import notification_service as ns
    from app.models.entities import Project
    proj = await db.get(Project, project_id)
    if proj: await ns.notify(db, user_id=proj.customer_id, project_id=project_id, notification_type="approval", title="Материал на согласовании", body=p.name, link_path="/approvals")
    return _out(p)

@router.post("/{project_id}/material-picks/{pick_id}/approve")
async def approve_pick(project_id: str, pick_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer: raise HTTPException(403)
    p = await db.get(MaterialPick, pick_id)
    if not p or p.project_id != project_id: raise HTTPException(404)
    p.status = MaterialPickStatus.approved
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"Согласовано: {p.name}", work_type=p.work_type)
    from app.services import notification_service as ns
    from app.models.entities import Project
    proj = await db.get(Project, project_id)
    if proj and proj.contractor_id:
        await ns.notify(
            db,
            user_id=proj.contractor_id,
            project_id=project_id,
            notification_type="approval",
            title="Материал согласован",
            body=p.name,
            link_path="/(contractor)/(tabs)/repair?tab=materials",
        )
    return _out(p)

@router.post("/{project_id}/material-picks/{pick_id}/analog")
async def add_analog(project_id: str, pick_id: str, body: PickIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    orig = await db.get(MaterialPick, pick_id)
    if not orig or orig.project_id != project_id: raise HTTPException(404)
    p = MaterialPick(project_id=project_id, analog_of_id=pick_id, **body.model_dump())
    db.add(p); await db.commit(); await db.refresh(p)
    return _out(p)


@router.post("/{project_id}/material-picks/{pick_id}/sync-price")
async def sync_price(project_id: str, pick_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Stub: парсинг цены по URL (Petrovich/Leroy — позже)."""
    await require_project(db, project_id, user, write=True)
    p = await db.get(MaterialPick, pick_id)
    if not p or p.project_id != project_id: raise HTTPException(404)
    from app.services.price_parser import fetch_price
    if p.shop_url:
        p.price, _shop, _src = await fetch_price(p.shop_url, p.price)
    elif not p.price:
        p.price = 1000.0
    await db.commit()
    return _out(p)
