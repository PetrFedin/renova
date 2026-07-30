"""Source-hydration integrity layer over the existing budget implementation."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, PaymentStatus, Purchase, PurchaseStatus, Receipt
from app.services import budget_service_legacy as _legacy
from app.services.budget_service_legacy import *  # noqa: F401,F403

SOURCE_PROTECTED_EXPENSE_STATUSES = frozenset({"disputed", "refund", "deleted"})
_SOURCE_STATUS_PRIORITY = {
    "deleted": 0,
    "refund": 1,
    "disputed": 2,
    "confirmed": 3,
    "pending_receipt": 4,
}
_ORIGINAL_REFRESH_BUDGET_FACTS = _legacy.refresh_budget_facts


def is_source_protected_expense(expense: Expense) -> bool:
    return str(expense.status or "") in SOURCE_PROTECTED_EXPENSE_STATUSES


def _canonical_created_at(created_at: datetime | None) -> float:
    """Return a deterministic UTC ordering value for naive, aware, or missing timestamps."""
    if created_at is None:
        return float("-inf")
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.astimezone(timezone.utc).timestamp()


def _expense_canonical_key(expense: Expense) -> tuple[int, float, str]:
    return (
        _SOURCE_STATUS_PRIORITY.get(str(expense.status or ""), 5),
        _canonical_created_at(expense.created_at),
        expense.id,
    )


def _merge_source_links(keep: Expense, duplicate: Expense) -> None:
    """Preserve source identity while never copying mutable financial fields."""
    for field in ("receipt_id", "payment_id", "purchase_id", "material_pick_id"):
        if getattr(keep, field, None) is None and getattr(duplicate, field, None) is not None:
            setattr(keep, field, getattr(duplicate, field))


async def _collapse_linked_candidates(
    db: AsyncSession,
    candidates: list[Expense | None],
) -> Expense | None:
    unique = {candidate.id: candidate for candidate in candidates if candidate is not None}
    if not unique:
        return None
    rows = list(unique.values())
    keep = min(rows, key=_expense_canonical_key)
    for duplicate in rows:
        if duplicate.id == keep.id:
            continue
        _merge_source_links(keep, duplicate)
        await db.delete(duplicate)
    if len(rows) > 1:
        await db.flush()
    return keep


async def _dedupe_linked_expenses(
    db: AsyncSession,
    *,
    receipt_id: str | None = None,
    payment_id: str | None = None,
    purchase_id: str | None = None,
) -> Expense | None:
    """Keep the strongest ledger evidence, not merely the oldest duplicate."""
    query = select(Expense)
    if receipt_id:
        query = query.where(Expense.receipt_id == receipt_id)
    elif payment_id:
        query = query.where(Expense.payment_id == payment_id)
    elif purchase_id:
        query = query.where(Expense.purchase_id == purchase_id)
    else:
        return None
    try:
        query = query.with_for_update()
    except Exception:
        pass
    rows = list((await db.execute(query)).scalars().all())
    return await _collapse_linked_candidates(db, rows)


async def expense_from_receipt(
    db: AsyncSession,
    rec: Receipt,
    *,
    title: str | None = None,
) -> Expense:
    if not rec.id:
        await db.flush()
    await _legacy._cleanup_receipt_orphans(db, rec)
    existing = await _dedupe_linked_expenses(db, receipt_id=rec.id)
    if existing:
        if is_source_protected_expense(existing):
            return existing
        existing.amount = rec.amount
        existing.category = rec.expense_category
        existing.room_id = rec.room_id
        existing.stage_id = rec.stage_id
        if getattr(rec, "payment_id", None):
            existing.payment_id = rec.payment_id
        existing.status = "confirmed" if rec.fns_verified else "pending_receipt"
        await db.flush()
        return existing
    expense = Expense(
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
        expense_date=rec.created_at or _legacy.utc_now(),
    )
    db.add(expense)
    await db.flush()
    return expense


async def expense_from_payment(db: AsyncSession, pay: Payment) -> Expense | None:
    if pay.status != PaymentStatus.confirmed:
        return None
    existing = await _dedupe_linked_expenses(db, payment_id=pay.id)
    if existing:
        return existing
    expense = Expense(
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
    db.add(expense)
    await db.flush()
    return expense


async def _purge_stale_purchase_expenses(db: AsyncSession, project_id: str) -> None:
    """Remove stale active facts while retaining dispute/refund/delete evidence."""
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
    rows = list(
        (
            await db.execute(
                select(Expense).where(
                    Expense.project_id == project_id,
                    Expense.purchase_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    removed = False
    for row in rows:
        if row.purchase_id not in active_purchase_ids and not is_source_protected_expense(row):
            await db.delete(row)
            removed = True
    if removed:
        await db.flush()


async def expense_from_purchase(db: AsyncSession, purchase: Purchase) -> Expense | None:
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
    purchase_existing = await _dedupe_linked_expenses(db, purchase_id=purchase.id)
    expense = await _collapse_linked_candidates(db, [purchase_existing, receipt_existing])

    if expense and is_source_protected_expense(expense):
        return expense
    if not expense:
        expense = Expense(
            project_id=purchase.project_id,
            purchase_id=purchase.id,
            title=_legacy._purchase_title(purchase),
            category="materials",
            amount=amount,
            status="confirmed",
            payment_method="transfer",
            expense_date=purchase.paid_at or purchase.delivered_at or purchase.created_at or _legacy.utc_now(),
        )
        db.add(expense)

    expense.project_id = purchase.project_id
    expense.purchase_id = purchase.id
    expense.receipt_id = purchase.receipt_id
    expense.room_id = _legacy._single_purchase_field(purchase, "room_id")
    expense.stage_id = _legacy._single_purchase_field(purchase, "stage_id")
    expense.material_pick_id = _legacy._single_purchase_field(purchase, "material_pick_id")
    expense.title = _legacy._purchase_title(purchase)
    expense.category = "materials"
    expense.amount = amount
    expense.status = "confirmed"
    expense.payment_method = expense.payment_method or "transfer"
    expense.supplier_name = purchase.supplier_name
    expense.expense_date = purchase.paid_at or purchase.delivered_at or expense.expense_date or purchase.created_at or _legacy.utc_now()
    await db.flush()
    return expense


async def refresh_budget_facts(db: AsyncSession, project_id: str) -> None:
    """Run the existing refresh with protected hydration functions installed."""
    await _ORIGINAL_REFRESH_BUDGET_FACTS(db, project_id)


# Existing legacy functions resolve their globals at call time. Installing the protected
# implementations here keeps budget_summary/update/delete and all existing callers intact.
_legacy._dedupe_linked_expenses = _dedupe_linked_expenses
_legacy.expense_from_receipt = expense_from_receipt
_legacy.expense_from_payment = expense_from_payment
_legacy._purge_stale_purchase_expenses = _purge_stale_purchase_expenses
_legacy.expense_from_purchase = expense_from_purchase
_legacy.refresh_budget_facts = refresh_budget_facts