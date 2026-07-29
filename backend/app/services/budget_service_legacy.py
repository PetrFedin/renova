"""Бюджет Renova OS: BudgetLine, Expense, прогноз и отклонения."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    BudgetLine,
    EstimateLine,
    Expense,
    LineType,
    Payment,
    PaymentStatus,
    Project,
    Purchase,
    PurchaseStatus,
    Receipt,
)

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


async def _dedupe_linked_expenses(
    db: AsyncSession,
    *,
    receipt_id: str | None = None,
    payment_id: str | None = None,
    purchase_id: str | None = None,
) -> Expense | None:
    """Оставляет одну запись Expense на receipt/payment/purchase — убирает дубликаты из старых данных."""
    q = select(Expense)
    if receipt_id:
        q = q.where(Expense.receipt_id == receipt_id)
    elif payment_id:
        q = q.where(Expense.payment_id == payment_id)
    elif purchase_id:
        q = q.where(Expense.purchase_id == purchase_id)
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
        expense_date=rec.created_at or utc_now(),
    )
    db.add(exp)
    await db.flush()
    return exp



async def expense_from_bank_row(
    db: AsyncSession,
    *,
    project_id: str,
    amount: float,
    title: str,
    expense_date: datetime | None = None,
    comment: str | None = None,
) -> Expense:
    """W74: строка банковской выписки без матча → расход (факт без эквайринга)."""
    exp = Expense(
        project_id=project_id,
        title=(title or f"Выписка {amount:.0f} ₽")[:255],
        category="other",
        amount=abs(float(amount)),
        status="confirmed",
        payment_method="bank_transfer",
        comment=(comment or "bank_statement_unmatched")[:500],
        expense_date=expense_date or utc_now(),
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


def _single_purchase_field(purchase: Purchase, field: str) -> str | None:
    values = {
        value
        for item in (purchase.items or [])
        if (value := getattr(item, field, None))
    }
    if len(values) == 1:
        return next(iter(values))
    return None


def _purchase_title(purchase: Purchase) -> str:
    supplier_name = (purchase.supplier_name or "").strip()
    if supplier_name:
        return f"Закупка · {supplier_name}"
    item_names = [item.name for item in (purchase.items or []) if item.name]
    if len(item_names) == 1:
        return f"Закупка · {item_names[0]}"
    return "Закупка материалов"


async def _purge_stale_purchase_expenses(db: AsyncSession, project_id: str) -> None:
    """Убирает ledger-записи по закупкам, которые уже не должны участвовать в факте."""
    active_purchase_ids = {
        purchase_id
        for purchase_id, in (
            await db.execute(
                select(Purchase.id).where(
                    Purchase.project_id == project_id,
                    Purchase.status.in_((PurchaseStatus.paid, PurchaseStatus.delivered)),
                )
            )
        ).all()
    }
    rows = (
        await db.execute(
            select(Expense).where(
                Expense.project_id == project_id,
                Expense.purchase_id.is_not(None),
            )
        )
    ).scalars().all()
    removed = False
    for row in rows:
        if row.purchase_id not in active_purchase_ids:
            await db.delete(row)
            removed = True
    if removed:
        await db.flush()


async def expense_from_purchase(db: AsyncSession, purchase: Purchase) -> Expense | None:
    """W56: канон факта материалов — Expense создаётся на paid, delivered добирает пропущенную оплату."""
    if purchase.status not in (PurchaseStatus.paid, PurchaseStatus.delivered):
        return None

    amount = round(float(purchase.total_amount or 0), 2)
    if amount <= 0:
        amount = round(
            sum(float(item.qty or 0) * float(item.unit_price or 0) for item in (purchase.items or [])),
            2,
        )
    if amount <= 0:
        return None

    receipt_existing = None
    if purchase.receipt_id:
        receipt_existing = await _dedupe_linked_expenses(db, receipt_id=purchase.receipt_id)
    existing = await _dedupe_linked_expenses(db, purchase_id=purchase.id)
    exp = existing or receipt_existing
    if existing and receipt_existing and existing.id != receipt_existing.id:
        await db.delete(receipt_existing)
        await db.flush()

    if not exp:
        exp = Expense(
            project_id=purchase.project_id,
            purchase_id=purchase.id,
            title=_purchase_title(purchase),
            category="materials",
            amount=amount,
            status="confirmed",
            payment_method="transfer",
            expense_date=purchase.paid_at or purchase.delivered_at or purchase.created_at or utc_now(),
        )
        db.add(exp)

    exp.project_id = purchase.project_id
    exp.purchase_id = purchase.id
    exp.receipt_id = purchase.receipt_id
    exp.room_id = _single_purchase_field(purchase, "room_id")
    exp.stage_id = _single_purchase_field(purchase, "stage_id")
    exp.material_pick_id = _single_purchase_field(purchase, "material_pick_id")
    exp.title = _purchase_title(purchase)
    exp.category = "materials"
    exp.amount = amount
    exp.status = "confirmed"
    exp.payment_method = exp.payment_method or "transfer"
    exp.supplier_name = purchase.supplier_name
    exp.expense_date = purchase.paid_at or purchase.delivered_at or exp.expense_date or purchase.created_at or utc_now()
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
    purchases = (
        await db.execute(
            select(Purchase)
            .where(
                Purchase.project_id == project_id,
                Purchase.status.in_((PurchaseStatus.paid, PurchaseStatus.delivered)),
            )
        )
    ).scalars().all()
    for purchase in purchases:
        await expense_from_purchase(db, purchase)
    await _purge_stale_purchase_expenses(db, project_id)
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




async def sync_project_budget_planned(db: AsyncSession, project_id: str) -> float:
    """W45: единственный writer projects.budget_planned = Σ estimate + Σ approved CO."""
    from app.models.entities import ChangeOrder, ChangeOrderStatus, EstimateLine

    est_lines = list(
        (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    )
    estimate_total = sum(float(l.quantity_planned or 0) * float(l.unit_price or 0) for l in est_lines)
    cos = list(
        (
            await db.execute(
                select(ChangeOrder).where(
                    ChangeOrder.project_id == project_id,
                    ChangeOrder.status == ChangeOrderStatus.approved,
                )
            )
        ).scalars().all()
    )
    co_total = sum(float(c.amount or 0) for c in cos)
    total = round(estimate_total + co_total, 2)
    proj = await db.get(Project, project_id)
    if proj:
        proj.budget_planned = total
    await db.flush()
    return total


async def apply_change_order_to_budget(db: AsyncSession, co) -> BudgetLine:
    """P3.2c: при одобрении CO — строка бюджета «works» + delta planned."""
    marker = f"[co:{co.id}]"
    lines = (
        await db.execute(
            select(BudgetLine).where(
                BudgetLine.project_id == co.project_id,
                BudgetLine.description.contains(marker),
            )
        )
    ).scalars().all()
    if lines:
        bl = lines[0]
        bl.planned_amount = round(co.amount, 2)
        bl.description = f"Доп. работы: {co.title} {marker}"
        await db.flush()
        return bl
    bl = BudgetLine(
        project_id=co.project_id,
        category="works",
        description=f"Доп. работы: {co.title} {marker}",
        planned_amount=round(co.amount, 2),
        expense_type="works",
        status="active",
    )
    db.add(bl)
    await db.flush()
    return bl


async def budget_summary(db: AsyncSession, project_id: str) -> dict:
    await refresh_budget_facts(db, project_id)
    proj = await db.get(Project, project_id)
    if not proj:
        return {}
    lines = (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    planned = sum(bl.planned_amount for bl in lines if bl.category != "reserve")
    reserve = sum(bl.planned_amount for bl in lines if bl.category == "reserve")
    # W45: план проекта — SoT (estimate + approved CO), не max(lines, project)
    await sync_project_budget_planned(db, project_id)
    await db.commit()
    await db.refresh(proj)
    total_plan = float(proj.budget_planned or 0)
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
    # W71: ДО в сводке бюджета — связь смета ↔ change orders ↔ plan
    from app.models.entities import ChangeOrder, ChangeOrderStatus

    cos = list(
        (
            await db.execute(
                select(ChangeOrder)
                .where(ChangeOrder.project_id == project_id)
                .order_by(ChangeOrder.created_at.desc())
            )
        ).scalars().all()
    )
    change_orders = [
        {
            "id": c.id,
            "title": c.title,
            "amount": round(float(c.amount or 0), 2),
            "status": c.status.value if hasattr(c.status, "value") else str(c.status),
            "description": (c.description or "")[:160],
        }
        for c in cos[:20]
    ]
    co_approved_sum = round(
        sum(float(c.amount or 0) for c in cos if c.status == ChangeOrderStatus.approved),
        2,
    )

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
        "change_orders": change_orders,
        "change_orders_approved_sum": co_approved_sum,
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



async def budget_hub(db: AsyncSession, project_id: str, *, threshold_pct: float = 5.0) -> dict:
    """P2.5 BFF: один JSON для mobile budget hub."""
    from sqlalchemy import select
    from app.models.entities import MaterialPick, Project, Room, EstimateLine, Receipt
    from app.services import payment_service as pay_svc

    summary = await budget_summary(db, project_id)
    expenses = [expense_dict(e) for e in await list_expenses(db, project_id)]
    payments = []
    for item in await pay_svc.list_payments(db, project_id):
        receipt_id = await pay_svc.receipt_id_for_payment(db, item.id)
        payments.append(pay_svc.payment_dict(item, receipt_id=receipt_id))
    from app.services.fns.receipt_verify import receipt_meta

    receipt_rows = (await db.execute(select(Receipt).where(Receipt.project_id == project_id))).scalars().all()
    receipts = []
    for r in receipt_rows:
        meta = receipt_meta(r.qr_raw)
        receipts.append({
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
            "payment_id": getattr(r, "payment_id", None),
        })
    picks = []
    pick_rows = (await db.execute(select(MaterialPick).where(MaterialPick.project_id == project_id))).scalars().all()
    for mp in pick_rows:
        picks.append({
            "id": mp.id,
            "name": mp.name,
            "room_id": mp.room_id,
            "stage_id": getattr(mp, "stage_id", None),
            "qty": mp.qty,
            "qty_needed": mp.qty_needed,
            "qty_delivered": mp.qty_delivered or 0,
            "unit": mp.unit,
            "price": mp.price,
            "shop_url": mp.shop_url,
            "shop_name": mp.shop_name,
            "work_type": mp.work_type,
            "status": mp.status.value if hasattr(mp.status, "value") else mp.status,
            "category": getattr(mp, "category", None),
        })
    alerts = []
    rooms = (await db.execute(select(Room).where(Room.project_id == project_id))).scalars().all()
    for room in rooms:
        lines = (await db.execute(select(EstimateLine).where(EstimateLine.room_id == room.id))).scalars().all()
        plan = sum(l.quantity_planned * l.unit_price for l in lines)
        fact = sum(l.quantity_actual * l.unit_price for l in lines)
        recs = (await db.execute(select(Receipt).where(Receipt.project_id == project_id, Receipt.room_id == room.id))).scalars().all()
        receipts_spent = sum(r.amount for r in recs)
        total_fact = max(fact, receipts_spent)
        over_pct = round((total_fact / plan * 100) - 100, 1) if plan else 0
        if plan or total_fact:
            alerts.append({
                "room_id": room.id,
                "room_name": room.name,
                "plan": round(plan, 2),
                "fact": round(fact, 2),
                "over_pct": over_pct,
            })
    pending_payments = sum(1 for pay in payments if pay.get("status") == "pending")
    return {
        "summary": summary,
        "expenses": expenses,
        "payments": payments,
        "receipts": receipts,
        "material_picks": picks,
        "budget_alerts": alerts,
        "pending_payments_count": pending_payments,
        "threshold_pct": threshold_pct,
    }
