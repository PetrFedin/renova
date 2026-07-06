import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, MaterialPick, DesignPackage, UserRole, MaterialPickStatus, ChangeOrder, ChangeOrderStatus, RoomChangeRequest, RoomChangeStatus, WasteOrder, WasteOrderStatus

router = APIRouter(prefix="/projects", tags=["approvals"])

@router.get("/{project_id}/approvals")
async def approval_hub(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items: list[dict] = []
    mp = await db.execute(select(MaterialPick).where(MaterialPick.project_id == project_id, MaterialPick.status == MaterialPickStatus.pending))
    for p in mp.scalars().all():
        items.append({"id": p.id, "type": "material", "title": p.name, "subtitle": f"{p.qty} {p.unit} · {round(p.qty*p.price)} ₽", "status": p.status.value, "room_id": p.room_id, "stage_id": p.stage_id, "work_type": p.work_type})
    co = await db.execute(select(ChangeOrder).where(ChangeOrder.project_id == project_id, ChangeOrder.status == ChangeOrderStatus.pending))
    for c in co.scalars().all():
        items.append({"id": c.id, "type": "change_order", "title": c.title, "subtitle": f"{c.amount:.0f} ₽", "status": c.status.value, "room_id": None, "work_type": None})
    rr = await db.execute(select(RoomChangeRequest).where(RoomChangeRequest.project_id == project_id, RoomChangeRequest.status == RoomChangeStatus.pending))
    for r in rr.scalars().all():
        items.append({"id": r.id, "type": "room_change", "title": "Изменение комнаты", "subtitle": r.message[:80], "status": r.status.value, "room_id": r.room_id, "work_type": None})
    wo = await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id, WasteOrder.status == WasteOrderStatus.requested))
    for w in wo.scalars().all():
        items.append({"id": w.id, "type": "waste", "title": f"Вывоз {w.volume_m3} м³", "subtitle": w.notes or w.waste_type, "status": w.status.value, "room_id": w.room_id, "work_type": None})
    dg = await db.execute(select(DesignPackage).where(DesignPackage.project_id == project_id, DesignPackage.status == "pending"))
    for d in dg.scalars().all():
        items.append({"id": d.id, "type": "design", "title": d.title, "subtitle": f"v{d.version}", "status": d.status, "room_id": None, "work_type": None})
    pending = len(items)
    return {"pending_count": pending, "items": items}


class RejectIn(BaseModel):
    type: str
    reason: str = ""

@router.post("/{project_id}/approvals/{item_id}/reject")
async def reject_item(project_id: str, item_id: str, body: RejectIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer: raise HTTPException(403)
    from app.services import activity_service as act
    if body.type == "material":
        p = await db.get(MaterialPick, item_id)
        if not p or p.project_id != project_id: raise HTTPException(404)
        p.status = MaterialPickStatus.draft; p.notes = (p.notes or "") + f"\nОтклонено: {body.reason}"
        await db.commit()
        await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=f"Отклонено: {p.name}", body=body.reason)
    elif body.type == "change_order":
        c = await db.get(ChangeOrder, item_id)
        if not c or c.project_id != project_id: raise HTTPException(404)
        c.status = ChangeOrderStatus.rejected
        await db.commit()
    elif body.type == "room_change":
        r = await db.get(RoomChangeRequest, item_id)
        if not r or r.project_id != project_id: raise HTTPException(404)
        r.status = RoomChangeStatus.rejected
        await db.commit()
    elif body.type == "design":
        d = await db.get(DesignPackage, item_id)
        if not d or d.project_id != project_id: raise HTTPException(404)
        d.status = "rejected"
        await db.commit()
    elif body.type == "waste":
        w = await db.get(WasteOrder, item_id)
        if not w or w.project_id != project_id: raise HTTPException(404)
        w.status = WasteOrderStatus.cancelled; w.notes = (w.notes or "") + f"\nОтклонено: {body.reason}"
        await db.commit()
    else:
        raise HTTPException(400)
    return {"ok": True}
