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
    """W70 #20: reject пишет activity + notify подрядчику (симметрия с approve)."""
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    from app.services import activity_service as act
    from app.services import notification_service as ns
    from app.models.entities import Project

    proj = await db.get(Project, project_id)
    title = ""
    link = "/(contractor)/(tabs)/repair?tab=materials"

    if body.type == "material":
        p = await db.get(MaterialPick, item_id)
        if not p or p.project_id != project_id:
            raise HTTPException(404)
        p.status = MaterialPickStatus.draft
        p.notes = (p.notes or "") + f"\nОтклонено: {body.reason}"
        title = f"Отклонено: {p.name}"
        link = "/(contractor)/(tabs)/repair?tab=materials"
    elif body.type == "change_order":
        c = await db.get(ChangeOrder, item_id)
        if not c or c.project_id != project_id:
            raise HTTPException(404)
        c.status = ChangeOrderStatus.rejected
        title = f"Отклонено ДО: {c.title}"
        link = "/(contractor)/(tabs)/object?tab=estimate"
    elif body.type == "room_change":
        r = await db.get(RoomChangeRequest, item_id)
        if not r or r.project_id != project_id:
            raise HTTPException(404)
        r.status = RoomChangeStatus.rejected
        title = "Отклонено изменение комнаты"
        link = "/(contractor)/(tabs)/object?tab=rooms"
    elif body.type == "design":
        d = await db.get(DesignPackage, item_id)
        if not d or d.project_id != project_id:
            raise HTTPException(404)
        d.status = "rejected"
        title = f"Отклонён дизайн: {d.title}"
        link = "/(contractor)/(tabs)/object"
    elif body.type == "waste":
        w = await db.get(WasteOrder, item_id)
        if not w or w.project_id != project_id:
            raise HTTPException(404)
        w.status = WasteOrderStatus.cancelled
        w.notes = (w.notes or "") + f"\nОтклонено: {body.reason}"
        title = f"Отклонён вывоз {w.volume_m3} м³"
        link = "/(contractor)/(tabs)/repair"
    else:
        raise HTTPException(400, "unknown_approval_type")

    await db.commit()
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="approval",
        title=title,
        body=body.reason or None,
    )
    if proj and proj.contractor_id:
        await ns.notify(
            db,
            user_id=proj.contractor_id,
            project_id=project_id,
            notification_type="approval",
            title=title,
            body=body.reason or "Заказчик отклонил из очереди Approvals",
            link_path=link,
        )
    return {"ok": True, "type": body.type, "id": item_id}


class ApproveIn(BaseModel):
    type: str


@router.post("/{project_id}/approvals/{item_id}/approve")
async def approve_item(project_id: str, item_id: str, body: ApproveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W66 #14: единый approve из approval hub."""
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    from app.services import activity_service as act
    from app.services import notification_service as ns
    from app.models.entities import Project

    proj = await db.get(Project, project_id)
    title = ""
    link = "/(contractor)/(tabs)/repair?tab=materials"

    if body.type == "material":
        p = await db.get(MaterialPick, item_id)
        if not p or p.project_id != project_id:
            raise HTTPException(404)
        p.status = MaterialPickStatus.approved
        title = f"Согласовано: {p.name}"
        link = "/(contractor)/(tabs)/repair?tab=materials"
    elif body.type == "change_order":
        # W71: тот же канон, что POST .../change-orders/{id}/approve — бюджет + черновик на подпись
        from app.services import change_order_service as co_svc

        c, draft_meta = await co_svc.approve_with_sign_draft(
            db, project_id=project_id, order_id=item_id, created_by=user.id
        )
        if not c:
            raise HTTPException(404)
        title = f"Согласовано ДО: {c.title}"
        link = "/(contractor)/(tabs)/budget"
        draft_id = (draft_meta or {}).get("id")
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="DocumentDraftForSign",
            title=f"Подпишите доп. работы: {c.title}",
            body=f"Документ {draft_id} · {c.amount:.0f} ₽",
            link_path="/documents",
        )
        if proj and proj.customer_id:
            await ns.notify(
                db,
                user_id=proj.customer_id,
                project_id=project_id,
                notification_type="document",
                title=f"Подпишите доп. работы: {c.title}",
                body=f"Черновик в Документах · {c.amount:.0f} ₽",
                link_path="/documents",
            )
        if proj and proj.contractor_id:
            await ns.notify(
                db,
                user_id=proj.contractor_id,
                project_id=project_id,
                notification_type="change_order",
                title=title,
                body=f"{c.amount:.0f} ₽ · план бюджета обновлён",
                link_path=link,
            )
        await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=title)
        return {
            "ok": True,
            "type": body.type,
            "id": item_id,
            "document_id": draft_id,
            "amount": c.amount,
            "budget_updated": True,
            "schedule_synced": bool((draft_meta or {}).get("schedule_synced")),
        }
    elif body.type == "room_change":
        r = await db.get(RoomChangeRequest, item_id)
        if not r or r.project_id != project_id:
            raise HTTPException(404)
        r.status = RoomChangeStatus.approved
        title = "Согласовано изменение комнаты"
        link = "/(contractor)/(tabs)/object?tab=rooms"
    elif body.type == "design":
        d = await db.get(DesignPackage, item_id)
        if not d or d.project_id != project_id:
            raise HTTPException(404)
        d.status = "approved"
        title = f"Согласован дизайн: {d.title}"
        link = "/(contractor)/(tabs)/object"
    elif body.type == "waste":
        w = await db.get(WasteOrder, item_id)
        if not w or w.project_id != project_id:
            raise HTTPException(404)
        w.status = WasteOrderStatus.scheduled
        title = f"Согласован вывоз {w.volume_m3} м³"
        link = "/(contractor)/(tabs)/repair"
    else:
        raise HTTPException(400, "unknown_approval_type")

    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="approval", title=title)
    if proj and proj.contractor_id:
        await ns.notify(
            db,
            user_id=proj.contractor_id,
            project_id=project_id,
            notification_type="approval",
            title=title,
            body="Заказчик согласовал из очереди Approvals",
            link_path=link,
        )
    return {"ok": True, "type": body.type, "id": item_id}
