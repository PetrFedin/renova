from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Receipt, User
from app.services.fns.receipt_verify import parse_receipt_qr, verify_receipt, receipt_meta
from app.services import project_service as proj_svc



def _resolve_stage_for_room(stages, room_id: str | None) -> str | None:
    if not room_id:
        return None
    from app.services.stage_service import parse_room_ids
    from app.models.entities import StageStatus
    priority = [StageStatus.active, StageStatus.review, StageStatus.planned, StageStatus.done]
    ordered = sorted(stages, key=lambda s: priority.index(s.status) if s.status in priority else 99)
    for st in ordered:
        if room_id in parse_room_ids(st):
            return st.id
    return None

router = APIRouter(prefix="/projects/{project_id}/receipts", tags=["receipts"])

VALID_CATEGORIES = {"materials", "labor", "delivery", "tools", "other"}


class ReceiptScan(BaseModel):
    qr_raw: str
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None


class ReceiptManual(BaseModel):
    amount: float
    description: str = ""
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None


class ReceiptPatch(BaseModel):
    expense_category: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    amount: float | None = None
    description: str | None = None


@router.post("/scan")
async def scan_receipt(project_id: str, body: ReceiptScan, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404)
    cat = body.expense_category if body.expense_category in VALID_CATEGORIES else "materials"
    stage_id = body.stage_id
    if not stage_id and body.room_id:
        from sqlalchemy import select
        from app.models.entities import Stage
        stg = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
        stage_id = _resolve_stage_for_room(stg, body.room_id)
    parsed = parse_receipt_qr(body.qr_raw)
    check = await verify_receipt(parsed)
    rec = Receipt(
        project_id=project_id,
        amount=parsed.get("amount", 0),
        qr_raw=body.qr_raw[:500],
        fn=parsed.get("fn"),
        fd=parsed.get("fd"),
        fns_verified=check["verified"],
        expense_category=cat,
        room_id=body.room_id,
        stage_id=stage_id,
    )
    db.add(rec)
    await db.flush()
    from app.services import budget_service as bud
    from app.services import activity_service as act
    exp = await bud.expense_from_receipt(db, rec)
    await bud.refresh_budget_facts(db, project_id)
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="ExpenseAdded", title=exp.title, body=str(exp.amount), link_path="/(customer)/(tabs)/budget")
    return {"id": rec.id, "amount": rec.amount, "verified": rec.fns_verified, "message": check["message"], "expense_category": cat, "room_id": rec.room_id, "stage_id": rec.stage_id}




@router.post("/manual")
async def manual_receipt(project_id: str, body: ReceiptManual, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Расход без QR: наличные, перевод, доставка."""
    if body.amount <= 0:
        raise HTTPException(400, "Сумма должна быть больше 0")
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404)
    cat = body.expense_category if body.expense_category in VALID_CATEGORIES else "materials"
    stage_id = body.stage_id
    if not stage_id and body.room_id:
        from sqlalchemy import select
        from app.models.entities import Stage
        stg = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
        stage_id = _resolve_stage_for_room(stg, body.room_id)
    desc = (body.description or "Ручной расход")[:500]
    rec = Receipt(
        project_id=project_id,
        amount=round(body.amount, 2),
        qr_raw=desc,
        fn="MANUAL",
        fd=None,
        fns_verified=True,
        expense_category=cat,
        room_id=body.room_id,
        stage_id=stage_id,
    )
    db.add(rec)
    await db.flush()
    from app.services import budget_service as bud
    from app.services import activity_service as act
    exp = await bud.expense_from_receipt(db, rec, title=desc)
    await bud.refresh_budget_facts(db, project_id)
    await db.commit()
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="ExpenseAdded", title=exp.title, body=str(exp.amount), link_path="/(customer)/(tabs)/budget")
    return {"id": rec.id, "amount": rec.amount, "verified": True, "source": "manual", "description": desc, "room_id": rec.room_id, "stage_id": rec.stage_id}

@router.patch("/{receipt_id}")
async def patch_receipt(project_id: str, receipt_id: str, body: ReceiptPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rec = await db.get(Receipt, receipt_id)
    if not rec or rec.project_id != project_id:
        raise HTTPException(404)
    if body.expense_category and body.expense_category in VALID_CATEGORIES:
        rec.expense_category = body.expense_category
    if body.room_id is not None:
        rec.room_id = body.room_id or None
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(400, detail="Сумма должна быть больше 0")
        old_amt = rec.amount
        rec.amount = round(body.amount, 2)
        p = await proj_svc.get_project(db, project_id)
        if p and rec.fns_verified:
            p.budget_spent = round(max(0, (p.budget_spent or 0) - old_amt + rec.amount), 2)
    if body.description is not None and rec.fn == "MANUAL":
        rec.qr_raw = (body.description or "Ручной расход")[:500]
    if body.stage_id is not None:
        rec.stage_id = body.stage_id or None
    from app.services import budget_service as bud
    await bud.expense_from_receipt(db, rec, title=rec.qr_raw if rec.fn == "MANUAL" else None)
    await bud.refresh_budget_facts(db, project_id)
    await db.commit()
    return {"ok": True, "amount": rec.amount, "expense_category": rec.expense_category, "room_id": rec.room_id, "stage_id": rec.stage_id}



@router.delete("/{receipt_id}")
async def delete_receipt(project_id: str, receipt_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Удалить чек и связанные расходы, пересчитать факт бюджета."""
    rec = await db.get(Receipt, receipt_id)
    if not rec or rec.project_id != project_id:
        raise HTTPException(404)
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404)
    from app.services import budget_service as bud
    removed = await bud.delete_receipt_expenses(db, receipt_id, rec=rec)
    await db.delete(rec)
    await bud.refresh_budget_facts(db, project_id)
    from app.services import activity_service as act
    await act.log_event(db, project_id=project_id, user_id=user.id, kind="ExpenseRemoved", title="Чек удалён", body=str(rec.amount), link_path="/(customer)/(tabs)/budget")
    await db.commit()
    return {"ok": True, "removed_amount": rec.amount}


@router.get("")
async def list_receipts(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404)
    out = []
    for r in p.receipts:
        meta = receipt_meta(r.qr_raw)
        out.append({
            "id": r.id,
            "amount": r.amount,
            "verified": r.fns_verified,
            "created_at": r.created_at.isoformat(),
            "receipt_at": meta.get("receipt_at"),
            "fn": r.fn,
            "expense_category": getattr(r, "expense_category", "materials"),
            "room_id": getattr(r, "room_id", None),
            "stage_id": getattr(r, "stage_id", None),
            "source": "manual" if r.fn == "MANUAL" else "scan",
            "description": r.qr_raw if r.fn == "MANUAL" else None,
        })
    return out
