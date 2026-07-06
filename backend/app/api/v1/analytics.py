from fastapi import APIRouter, Depends, HTTPException
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import LineType, Project, User, UserRole
from app.services import project_service as proj_svc

router = APIRouter(tags=["analytics"])

@router.get("/projects/analytics/contractor-summary")
async def contractor_summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    r = await db.execute(select(Project).where(Project.contractor_id == user.id))
    out = []
    for p in r.scalars().all():
        await db.refresh(p, ["estimate_lines", "stages"])
        mp = sum(l.quantity_planned * l.unit_price for l in p.estimate_lines if l.line_type == LineType.material)
        prog = sum(s.percent_complete for s in p.stages) / (len(p.stages) or 1)
        out.append({"id": p.id, "name": p.name, "margin_estimated": round(p.budget_planned - mp, 2), "progress_percent": round(prog, 1)})
    return out

@router.get("/projects/{project_id}/analytics")
async def analytics(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await proj_svc.get_project(db, project_id)
    if not p: raise HTTPException(404)
    materials = [l for l in p.estimate_lines if l.line_type == LineType.material]
    mp = sum(l.quantity_planned * l.unit_price for l in materials)
    mf = sum((l.quantity_actual or l.quantity_planned) * l.unit_price for l in materials)
    prog = sum(s.percent_complete for s in p.stages) / (len(p.stages) or 1)
    dl = (p.planned_end_date - date.today()).days if p.planned_end_date else None
    return {"budget_planned": p.budget_planned, "budget_spent": p.budget_spent, "margin_estimated": round(p.budget_planned - mp, 2), "materials_plan": round(mp, 2), "materials_fact": round(mf, 2), "progress_percent": round(prog, 1), "days_left": dl, "forecast_delay_days": max(0, -dl) if dl is not None and prog < 100 else 0}

@router.get("/projects/{project_id}/analytics/budget-alerts")
async def budget_alerts(project_id: str, threshold_pct: float = 5, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import EstimateLine, Room, Receipt
    p = await require_project(db, project_id, user, write=False)
    rooms = (await db.execute(select(Room).where(Room.project_id == project_id))).scalars().all()
    out = []
    for room in rooms:
        lines = (await db.execute(select(EstimateLine).where(EstimateLine.room_id == room.id))).scalars().all()
        plan = sum(l.quantity_planned * l.unit_price for l in lines)
        fact = sum(l.quantity_actual * l.unit_price for l in lines)
        recs = (await db.execute(select(Receipt).where(Receipt.project_id == project_id, Receipt.room_id == room.id))).scalars().all()
        receipts_spent = sum(r.amount for r in recs)
        total_fact = max(fact, receipts_spent)
        pct = (total_fact / plan * 100) if plan else 0
        out.append({"room_id": room.id, "room_name": room.name, "plan": plan, "fact": fact, "receipts_spent": round(receipts_spent, 2), "total_spent": round(total_fact, 2), "over_pct": round(pct - 100, 1) if plan else 0})
        skip_notify = False
        thr = (getattr(room, 'budget_alert_pct', None) or threshold_pct) / 100
        if plan and fact > plan * (1 + thr) and p.customer_id and user.id == p.customer_id:
            from datetime import date as ddate
            from app.models.entities import BudgetAlertSent
            today = ddate.today().isoformat()
            ex = (await db.execute(select(BudgetAlertSent).where(BudgetAlertSent.user_id == p.customer_id, BudgetAlertSent.room_id == room.id, BudgetAlertSent.sent_date == today))).scalar_one_or_none()
            skip_notify = bool(ex)
            from app.services import notification_service as ns
            from app.services.email_stub import send_budget_alert_email
            from app.models.entities import User as U
            if not skip_notify:
                await ns.notify(db, user_id=p.customer_id, project_id=project_id, notification_type='budget_alert', title='Превышение бюджета комнаты', body=f'{room.name}: {fact:.0f}/{plan:.0f}', link_path=f'/room/{room.id}', return_to='/(customer)/(tabs)/')
                cu = await db.get(U, p.customer_id)
                if cu and cu.email:
                    await send_budget_alert_email(cu.email, 'Renova: бюджет', f'{room.name} {fact:.0f}/{plan:.0f}')
                db.add(BudgetAlertSent(user_id=p.customer_id, room_id=room.id, sent_date=today))
                await db.commit()
    return out


@router.get("/projects/{project_id}/analytics/budget-room-lines/{room_id}")
async def budget_room_lines(project_id: str, room_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import EstimateLine
    await require_project(db, project_id, user, write=False)
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.room_id == room_id))).scalars().all()
    out = []
    for l in lines:
        plan = l.quantity_planned * l.unit_price
        fact = l.quantity_actual * l.unit_price
        if fact > plan and plan > 0:
            out.append({"id": l.id, "name": l.name, "plan": plan, "fact": fact, "over": round(fact - plan, 2)})
    return out
@router.get("/projects/{project_id}/analytics/budget-breakdown")
async def budget_breakdown(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select, func
    from app.models.entities import EstimateLine, LineType, MaterialPick, WasteOrder, Payment
    from app.services import project_service as ps
    p = await ps.get_project(db, project_id)
    if not p: raise HTTPException(404)
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    works = sum(l.quantity_planned * l.unit_price for l in lines if l.line_type == LineType.work)
    materials_plan = sum(l.quantity_planned * l.unit_price for l in lines if l.line_type == LineType.material)
    picks = (await db.execute(select(MaterialPick).where(MaterialPick.project_id == project_id))).scalars().all()
    materials_fact = sum(x.qty * x.price for x in picks if x.status.value in ("approved", "purchased"))
    waste = (await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id))).scalars().all()
    waste_sum = sum(w.volume_m3 * w.price for w in waste if w.status.value != "cancelled")
    reserve = max(0, p.budget_planned - works - materials_plan - waste_sum)
    return {"works": round(works, 2), "materials_plan": round(materials_plan, 2), "materials_fact": round(materials_fact, 2), "waste": round(waste_sum, 2), "reserve": round(reserve, 2), "total_planned": round(works + materials_plan + waste_sum + reserve, 2), "budget_planned": p.budget_planned, "budget_spent": p.budget_spent}


@router.get("/projects/{project_id}/analytics/budget-category-alerts")
async def budget_category_alerts(project_id: str, threshold_pct: float = 10, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import EstimateLine, LineType, MaterialPick, WasteOrder
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    picks = (await db.execute(select(MaterialPick).where(MaterialPick.project_id == project_id))).scalars().all()
    waste = (await db.execute(select(WasteOrder).where(WasteOrder.project_id == project_id))).scalars().all()
    cats = {"works": 0.0, "materials": 0.0, "waste": 0.0}
    fact = {"works": 0.0, "materials": 0.0, "waste": 0.0}
    for l in lines:
        k = "works" if l.line_type == LineType.work else "materials"
        cats[k] += l.quantity_planned * l.unit_price
    for p in picks:
        if p.status.value in ("approved", "purchased"): fact["materials"] += p.qty * p.price
    for w in waste:
        if w.status.value not in ("cancelled", "draft"): fact["waste"] += w.volume_m3 * w.price
    out = []
    for k, plan in cats.items():
        f = fact.get(k, 0)
        if plan and (f - plan) / plan * 100 >= threshold_pct:
            out.append({"category": k, "plan": round(plan, 2), "fact": round(f, 2), "over_pct": round((f - plan) / plan * 100, 1)})
    return out

@router.get("/projects/{project_id}/analytics/budget-forecast")
async def budget_forecast(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import project_service as ps
    p = await ps.get_project(db, project_id)
    if not p: raise HTTPException(404)
    prog = max(p.progress_percent, 1) / 100
    burn = p.budget_spent / prog if prog else p.budget_spent
    forecast = burn
    over = max(0, forecast - p.budget_planned)
    return {"budget_planned": p.budget_planned, "budget_spent": p.budget_spent, "progress_percent": p.progress_percent, "forecast_total": round(forecast, 2), "forecast_over": round(over, 2), "risk": "high" if over > p.budget_planned * 0.05 else "ok"}

@router.get("/projects/{project_id}/analytics/budget-scenario")
async def budget_scenario(project_id: str, materials_pct: float = 10, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import EstimateLine, LineType
    from app.services import project_service as ps
    p = await ps.get_project(db, project_id)
    if not p: raise HTTPException(404)
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    mat = sum(l.quantity_planned * l.unit_price for l in lines if l.line_type == LineType.material)
    delta = mat * materials_pct / 100
    return {"materials_plan": round(mat, 2), "delta": round(delta, 2), "new_total": round(p.budget_planned + delta, 2), "materials_pct": materials_pct}

@router.get("/projects/{project_id}/analytics/expenses-summary")
async def expenses_summary(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """План/факт по комнатам и этапам — единый факт из Expense (как budget_spent)."""
    from sqlalchemy import select
    from app.models.entities import EstimateLine, Room, Receipt, Stage, Expense, Project
    from app.services import budget_service as bud
    await require_project(db, project_id, user, write=False)
    await bud.refresh_budget_facts(db, project_id)
    proj = await db.get(Project, project_id)
    rooms = (await db.execute(select(Room).where(Room.project_id == project_id))).scalars().all()
    stages = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    receipts = (await db.execute(select(Receipt).where(Receipt.project_id == project_id))).scalars().all()
    expenses = (await db.execute(select(Expense).where(Expense.project_id == project_id, Expense.status.in_(("confirmed", "pending_receipt"))))).scalars().all()
    by_room = []
    for room in rooms:
        rl = [l for l in lines if l.room_id == room.id]
        plan = sum(l.quantity_planned * l.unit_price for l in rl)
        estimate_fact = sum(l.quantity_actual * l.unit_price for l in rl)
        receipt_spent = sum(r.amount for r in receipts if r.room_id == room.id)
        expense_spent = round(sum(e.amount for e in expenses if e.room_id == room.id and e.status == "confirmed"), 2)
        by_room.append({
            "room_id": room.id, "room_name": room.name, "room_type": room.room_type,
            "floor_level": getattr(room, "floor_level", 1) or 1,
            "plan": round(plan, 2), "estimate_fact": round(estimate_fact, 2),
            "receipts_spent": round(receipt_spent, 2),
            "expense_spent": expense_spent,
            "total_spent": round(max(estimate_fact, expense_spent, receipt_spent), 2),
        })
    by_stage = []
    for st in stages:
        rids = []
        import json
        if getattr(st, "room_ids_json", None):
            try: rids = json.loads(st.room_ids_json) or []
            except Exception: rids = []
        sl = [l for l in lines if l.room_id in rids] if rids else []
        plan = sum(l.quantity_planned * l.unit_price for l in sl) if sl else st.payment_amount
        receipt_spent = sum(r.amount for r in receipts if r.stage_id == st.id)
        expense_spent = round(sum(e.amount for e in expenses if e.stage_id == st.id and e.status == "confirmed"), 2)
        by_stage.append({
            "stage_id": st.id, "stage_name": st.name, "status": st.status.value if hasattr(st.status, "value") else str(st.status),
            "plan": round(plan, 2), "receipts_spent": round(receipt_spent, 2), "expense_spent": expense_spent,
            "payment_amount": round(st.payment_amount or 0, 2),
        })
    expenses_total = round(proj.budget_spent, 2) if proj else round(sum(e.amount for e in expenses if e.status == "confirmed"), 2)
    return {"by_room": by_room, "by_stage": by_stage, "receipts_total": round(sum(r.amount for r in receipts), 2), "expenses_total": expenses_total}

@router.get("/projects/{project_id}/analytics/expenses.csv")
async def expenses_csv(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """CSV: расходы по комнатам и этапам."""
    import csv, io
    from fastapi.responses import StreamingResponse
    data = await expenses_summary(project_id, user, db)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Раздел", "Название", "План", "Чеки", "Итого"])
    for r in data["by_room"]:
        w.writerow(["Комната", r["room_name"], r["plan"], r["receipts_spent"], r["total_spent"]])
    for s in data["by_stage"]:
        w.writerow(["Этап", s["stage_name"], s["plan"], s["receipts_spent"], s.get("payment_amount", 0)])
    w.writerow(["Итого чеки", "", "", data["receipts_total"], ""])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=renova-expenses.csv"})

