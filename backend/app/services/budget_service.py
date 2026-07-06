"""Бюджет Renova OS: BudgetLine, Expense, прогноз и отклонения."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import BudgetLine, EstimateLine, Expense, LineType, Payment, PaymentStatus, Project, Receipt

RESERVE_PCT = 0.12
CATEGORY_MAP = {
    LineType.work: ("works", "works"),
    LineType.material: ("materials", "materials"),
}


def expense_dict(e: Expense) -> dict:
    return {
        "id": e.id,
        "project_id": e.project_id,
        "room_id": e.room_id,
        "stage_id": e.stage_id,
        "title": e.title,
        "category": e.category,
        "amount": e.amount,
        "currency": e.currency,
        "payment_method": e.payment_method,
        "supplier_name": e.supplier_name,
        "comment": e.comment,
        "status": e.status,
        "receipt_id": e.receipt_id,
        "payment_id": e.payment_id,
        "purchase_id": e.purchase_id,
        "expense_date": e.expense_date.isoformat() if e.expense_date else None,
    }


def budget_line_dict(b: BudgetLine) -> dict:
    deviation = round(b.actual_amount - b.planned_amount, 2)
    pct = round((deviation / b.planned_amount * 100), 1) if b.planned_amount else 0
    return {
        "id": b.id,
        "project_id": b.project_id,
        "room_id": b.room_id,
        "stage_id": b.stage_id,
        "category": b.category,
        "description": b.description,
        "planned_amount": b.planned_amount,
        "actual_amount": b.actual_amount,
        "deviation": deviation,
        "deviation_pct": pct,
        "expense_type": b.expense_type,
        "status": b.status,
    }


async def sync_budget_lines_from_estimate(db: AsyncSession, project_id: str) -> list[BudgetLine]:
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    existing = (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    by_est = {b.estimate_line_id: b for b in existing if b.estimate_line_id}
    out: list[BudgetLine] = []
    subtotal = 0.0
    for el in lines:
        cat, etype = CATEGORY_MAP.get(el.line_type, ("other", "other"))
        planned = round(el.quantity_planned * el.unit_price, 2)
        subtotal += planned
        if el.id in by_est:
            bl = by_est[el.id]
            bl.planned_amount = planned
            bl.description = el.name
            bl.category = cat
            bl.expense_type = etype
            bl.room_id = el.room_id
        else:
            bl = BudgetLine(project_id=project_id, room_id=el.room_id, estimate_line_id=el.id, category=cat, description=el.name, planned_amount=planned, expense_type=etype)
            db.add(bl)
        out.append(bl)
    reserve = round(subtotal * RESERVE_PCT, 2)
    reserve_bl = next((b for b in existing if b.category == "reserve"), None)
    if reserve_bl:
        reserve_bl.planned_amount = reserve
    elif reserve > 0:
        db.add(BudgetLine(project_id=project_id, category="reserve", description="Резерв 12%", planned_amount=reserve, expense_type="reserve"))
    await db.flush()
    return out




async def _cleanup_receipt_orphans(db: AsyncSession, rec: Receipt) -> None:
    """Удаляет Expense-сироты без receipt_id (создавались до flush чека)."""
    if not rec.id:
        await db.flush()
    q = select(Expense).where(
        Expense.project_id == rec.project_id,
        Expense.receipt_id.is_(None),
        Expense.payment_id.is_(None),
        Expense.purchase_id.is_(None),
        Expense.amount == rec.amount,
        Expense.status.in_(("confirmed", "pending_receipt")),
    )
    if rec.room_id:
        q = q.where(Expense.room_id == rec.room_id)
    orphans = (await db.execute(q)).scalars().all()
    for o in orphans:
        await db.delete(o)
    if orphans:
        await db.flush()


async def _purge_orphan_receipt_expenses(db: AsyncSession, project_id: str) -> None:
    """Чистит «Чек …» без receipt_id — после удаления чека или старых багов."""
    rows = (
        await db.execute(
            select(Expense).where(
                Expense.project_id == project_id,
                Expense.receipt_id.is_(None),
                Expense.payment_id.is_(None),
                Expense.purchase_id.is_(None),
                Expense.status.in_(("confirmed", "pending_receipt")),
            )
        )
    ).scalars().all()
    for e in rows:
        if e.title and e.title.startswith("Чек "):
            await db.delete(e)
    await db.flush()


async def _dedupe_linked_expenses(db: AsyncSession, *, receipt_id: str | None = None, payment_id: str | None = None) -> Expense | None:
    """Оставляет одну запись Expense на receipt/payment — убирает дубликаты из старых данных."""
    q = select(Expense)
    if receipt_id:
        q = q.where(Expense.receipt_id == receipt_id)
    elif payment_id:
        q = q.where(Expense.payment_id == payment_id)
    else:
        return None
    rows = (await db.execute(q.order_by(Expense.created_at))).scalars().all()
    if not rows:
        return None
    keep = rows[0]
    for dup in rows[1:]:
        await db.delete(dup)
    if len(rows) > 1:
        await db.flush()
    return keep


async def delete_receipt_expenses(db: AsyncSession, receipt_id: str, rec: Receipt | None = None) -> float:
    """Удаляет все Expense, привязанные к чеку, и сироты по сумме/комнате."""
    rows = (await db.execute(select(Expense).where(Expense.receipt_id == receipt_id))).scalars().all()
    removed = 0.0
    for e in rows:
        if e.status == "confirmed":
            removed += e.amount
        await db.delete(e)
    if rec:
        await _cleanup_receipt_orphans(db, rec)
    await db.flush()
    return round(removed, 2)


async def expense_from_receipt(db: AsyncSession, rec: Receipt, *, title: str | None = None) -> Expense:
    if not rec.id:
        await db.flush()
    await _cleanup_receipt_orphans(db, rec)
    existing = await _dedupe_linked_expenses(db, receipt_id=rec.id)
    if existing:
        existing.amount = rec.amount
        existing.category = rec.expense_category
        existing.room_id = rec.room_id
        existing.stage_id = rec.stage_id
        if getattr(rec, "payment_id", None):
            existing.payment_id = rec.payment_id
        existing.status = "confirmed" if rec.fns_verified else "pending_receipt"
        await db.flush()
        return existing
    exp = Expense(
        project_id=rec.project_id,
        room_id=rec.room_id,
        stage_id=rec.stage_id,
        receipt_id=rec.id,
        payment_id=getattr(rec, "payment_id", None),
        title=title or f"Чек {rec.amount:.0f} ₽",
        category=rec.expense_category,
        amount=rec.amount,
        status="confirmed" if rec.fns_verified else "pending_receipt",
        payment_method="card",
        expense_date=rec.created_at or datetime.utcnow(),
    )
    db.add(exp)
    await db.flush()
    return exp


async def expense_from_payment(db: AsyncSession, pay: Payment) -> Expense | None:
    if pay.status != PaymentStatus.confirmed:
        return None
    existing = await _dedupe_linked_expenses(db, payment_id=pay.id)
    if existing:
        return existing
    exp = Expense(
        project_id=pay.project_id,
        stage_id=pay.stage_id,
        payment_id=pay.id,
        title=pay.title,
        category="works" if pay.payment_type.value in ("stage", "advance", "final") else "materials",
        amount=pay.amount,
        status="confirmed",
        payment_method="transfer",
        expense_date=pay.confirmed_at or pay.created_at,
    )
    db.add(exp)
    await db.flush()
    return exp


async def refresh_budget_facts(db: AsyncSession, project_id: str) -> None:
    await sync_budget_lines_from_estimate(db, project_id)
    receipts = (await db.execute(select(Receipt).where(Receipt.project_id == project_id))).scalars().all()
    for rec in receipts:
        await expense_from_receipt(db, rec)
    await _purge_orphan_receipt_expenses(db, project_id)
    payments = (await db.execute(select(Payment).where(Payment.project_id == project_id, Payment.status == PaymentStatus.confirmed))).scalars().all()
    for pay in payments:
        await expense_from_payment(db, pay)
    expenses = (await db.execute(select(Expense).where(Expense.project_id == project_id, Expense.status.in_(("confirmed", "pending_receipt"))))).scalars().all()
    lines = (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    cat_totals: dict[str, float] = {}
    for e in expenses:
        cat = e.category if e.category in ("works", "materials", "delivery", "tools", "other") else "other"
        cat_totals[cat] = cat_totals.get(cat, 0) + e.amount
    for bl in lines:
        if bl.category == "reserve":
            bl.actual_amount = 0
        elif bl.estimate_line_id:
            linked = [e for e in expenses if (e.room_id and e.room_id == bl.room_id) or (e.stage_id and e.stage_id == bl.stage_id)]
            bl.actual_amount = round(sum(e.amount for e in linked if e.category == bl.category), 2)
        else:
            bl.actual_amount = round(cat_totals.get(bl.category, 0), 2)
    proj = await db.get(Project, project_id)
    if proj:
        proj.budget_spent = round(sum(e.amount for e in expenses if e.status == "confirmed"), 2)
    await db.flush()


async def budget_summary(db: AsyncSession, project_id: str) -> dict:
    await refresh_budget_facts(db, project_id)
    proj = await db.get(Project, project_id)
    if not proj:
        return {}
    lines = (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    planned = sum(bl.planned_amount for bl in lines if bl.category != "reserve")
    reserve = sum(bl.planned_amount for bl in lines if bl.category == "reserve")
    total_plan = planned + reserve if planned else proj.budget_planned
    actual = proj.budget_spent
    deviation = round(actual - total_plan, 2)
    deviation_pct = round(deviation / total_plan * 100, 1) if total_plan else 0
    progress = proj.progress_percent or 0
    forecast = round(actual / (progress / 100), 2) if progress > 5 else total_plan
    over_risk = round(forecast - total_plan, 2)
    segments = {}
    for cat in ("works", "materials", "delivery", "tools", "other", "reserve"):
        seg_plan = sum(bl.planned_amount for bl in lines if bl.category == cat)
        seg_fact = sum(bl.actual_amount for bl in lines if bl.category == cat)
        if seg_plan or seg_fact:
            segments[cat] = {"planned": round(seg_plan, 2), "actual": round(seg_fact, 2)}
    return {
        "budget_planned": round(total_plan, 2),
        "budget_spent": round(actual, 2),
        "reserve": round(reserve, 2),
        "deviation": deviation,
        "deviation_pct": deviation_pct,
        "forecast_total": forecast,
        "forecast_over": max(0, over_risk),
        "risk": "high" if over_risk > total_plan * 0.05 else ("medium" if over_risk > 0 else "ok"),
        "segments": segments,
        "remaining": round(max(0, total_plan - actual), 2),
    }


async def list_expenses(db: AsyncSession, project_id: str, *, status: str | None = None, limit: int = 100) -> list[Expense]:
    q = select(Expense).where(Expense.project_id == project_id, Expense.status != "deleted")
    if status:
        q = q.where(Expense.status == status)
    return list((await db.execute(q.order_by(Expense.expense_date.desc()).limit(limit))).scalars().all())


async def get_expense(db: AsyncSession, expense_id: str) -> Expense | None:
    return await db.get(Expense, expense_id)


async def update_expense(
    db: AsyncSession,
    expense: Expense,
    *,
    amount: float | None = None,
    title: str | None = None,
    category: str | None = None,
    room_id: str | None = ...,  # type: ignore[assignment]
    stage_id: str | None = ...,  # type: ignore[assignment]
) -> Expense:
    """Правка записи расхода без связи с чеком/оплатой."""
    if expense.receipt_id or expense.payment_id:
        raise ValueError("linked_expense")
    if amount is not None:
        if amount <= 0:
            raise ValueError("invalid_amount")
        expense.amount = round(amount, 2)
    if title is not None:
        expense.title = title.strip() or expense.title
    if category is not None and category in ("works", "materials", "delivery", "tools", "other"):
        expense.category = category
    if room_id is not ...:
        expense.room_id = room_id or None
    if stage_id is not ...:
        expense.stage_id = stage_id or None
    await db.flush()
    await refresh_budget_facts(db, expense.project_id)
    return expense


async def delete_expense(db: AsyncSession, expense: Expense) -> None:
    if expense.payment_id:
        raise ValueError("linked_payment")
    if expense.receipt_id:
        raise ValueError("linked_receipt")
    expense.status = "deleted"
    await db.flush()
    await refresh_budget_facts(db, expense.project_id)
