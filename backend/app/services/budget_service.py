"""Source-hydration and budget-projection integrity over the legacy implementation."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    BudgetLine,
    EstimateLine,
    Expense,
    Payment,
    PaymentStatus,
    Project,
    Purchase,
    PurchaseStatus,
    Receipt,
)
from app.services import budget_service_legacy as _legacy
from app.services.budget_service_legacy import *  # noqa: F401,F403

SOURCE_PROTECTED_EXPENSE_STATUSES = frozenset({"disputed", "refund", "deleted"})
ACTIVE_BUDGET_EXPENSE_STATUSES = frozenset({"confirmed", "pending_receipt"})
BUDGET_CATEGORIES = frozenset({"works", "materials", "delivery", "tools", "other"})
_SYSTEM_ACTUAL_PREFIX = "[actual-unallocated:"
_CENT = Decimal("0.01")
_SOURCE_STATUS_PRIORITY = {
    "deleted": 0,
    "refund": 1,
    "disputed": 2,
    "confirmed": 3,
    "pending_receipt": 4,
}
_ORIGINAL_SYNC_BUDGET_LINES_FROM_ESTIMATE = _legacy.sync_budget_lines_from_estimate
_ORIGINAL_REFRESH_BUDGET_FACTS = _legacy.refresh_budget_facts


def _money(value: float | int | Decimal | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)


def _money_float(value: Decimal) -> float:
    return float(value.quantize(_CENT, rounding=ROUND_HALF_UP))


def _budget_category(value: str | None) -> str:
    return value if value in BUDGET_CATEGORIES else "other"


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


def _system_actual_marker(category: str, room_id: str | None, stage_id: str | None) -> str:
    return f"{_SYSTEM_ACTUAL_PREFIX}{category}:{room_id or '-'}:{stage_id or '-'}]"


def _system_actual_marker_from_line(line: BudgetLine) -> str | None:
    description = line.description or ""
    if not description.startswith(_SYSTEM_ACTUAL_PREFIX):
        return None
    end = description.find("]")
    return description[: end + 1] if end >= 0 else None


def _line_specificity(line: BudgetLine, expense: Expense, category: str) -> int | None:
    if line.category != category or line.category == "reserve" or _system_actual_marker_from_line(line):
        return None
    score = 0
    if line.room_id is not None:
        if line.room_id != expense.room_id:
            return None
        score += 1
    if line.stage_id is not None:
        if line.stage_id != expense.stage_id:
            return None
        score += 1
    if score == 0 and (expense.room_id is not None or expense.stage_id is not None):
        return None
    return score


async def sync_budget_lines_from_estimate(db: AsyncSession, project_id: str) -> list[BudgetLine]:
    """Sync current estimate rows and purge stale or duplicate projections."""
    out = await _ORIGINAL_SYNC_BUDGET_LINES_FROM_ESTIMATE(db, project_id)
    estimate_rows = list(
        (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all()
    )
    estimate_ids = {row.id for row in estimate_rows}
    lines = list(
        (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    )
    preferred_by_estimate = {
        line.estimate_line_id: line.id
        for line in out
        if line.estimate_line_id is not None
    }
    grouped: dict[str, list[BudgetLine]] = {}
    changed = False
    deleted_ids: set[str] = set()

    for line in lines:
        if not line.estimate_line_id:
            continue
        if line.estimate_line_id not in estimate_ids:
            await db.delete(line)
            deleted_ids.add(line.id)
            changed = True
            continue
        grouped.setdefault(line.estimate_line_id, []).append(line)

    for estimate_line_id, duplicates in grouped.items():
        preferred_id = preferred_by_estimate.get(estimate_line_id)
        keep = next((line for line in duplicates if line.id == preferred_id), None) or min(
            duplicates,
            key=lambda line: line.id,
        )
        for duplicate in duplicates:
            if duplicate.id == keep.id:
                continue
            await db.delete(duplicate)
            deleted_ids.add(duplicate.id)
            changed = True

    reserve_lines = [
        line
        for line in lines
        if line.id not in deleted_ids
        and line.category == "reserve"
        and line.estimate_line_id is None
        and _system_actual_marker_from_line(line) is None
    ]
    if reserve_lines:
        keep_reserve = min(reserve_lines, key=lambda line: line.id)
        subtotal = sum(
            _money(row.quantity_planned) * _money(row.unit_price)
            for row in estimate_rows
        )
        keep_reserve.planned_amount = _money_float(
            subtotal * Decimal(str(_legacy.RESERVE_PCT))
        )
        for duplicate in reserve_lines:
            if duplicate.id == keep_reserve.id:
                continue
            await db.delete(duplicate)
            changed = True

    if changed:
        await db.flush()
    return out


async def _reconcile_budget_line_actuals(db: AsyncSession, project_id: str) -> None:
    """Project each active expense exactly once; ambiguous links remain explicitly unallocated."""
    expenses = list(
        (
            await db.execute(
                select(Expense).where(
                    Expense.project_id == project_id,
                    Expense.status.in_(tuple(ACTIVE_BUDGET_EXPENSE_STATUSES)),
                )
            )
        ).scalars().all()
    )
    lines = list(
        (await db.execute(select(BudgetLine).where(BudgetLine.project_id == project_id))).scalars().all()
    )

    system_groups: dict[str, list[BudgetLine]] = {}
    for line in lines:
        marker = _system_actual_marker_from_line(line)
        if marker:
            system_groups.setdefault(marker, []).append(line)

    system_lines: dict[str, BudgetLine] = {}
    deleted_ids: set[str] = set()
    for marker, duplicates in system_groups.items():
        keep = min(duplicates, key=lambda line: line.id)
        system_lines[marker] = keep
        for duplicate in duplicates:
            if duplicate.id == keep.id:
                continue
            await db.delete(duplicate)
            deleted_ids.add(duplicate.id)

    active_lines = [line for line in lines if line.id not in deleted_ids]
    for line in active_lines:
        line.actual_amount = 0

    line_totals: dict[str, Decimal] = {}
    fallback_totals: dict[tuple[str, str | None, str | None], Decimal] = {}
    expected_total = Decimal("0")

    for expense in expenses:
        amount = _money(expense.amount)
        expected_total += amount
        category = _budget_category(expense.category)
        ranked = [
            (specificity, line)
            for line in active_lines
            if (specificity := _line_specificity(line, expense, category)) is not None
        ]
        if ranked:
            best_score = max(score for score, _ in ranked)
            best_lines = [line for score, line in ranked if score == best_score]
        else:
            best_lines = []

        if len(best_lines) == 1:
            line = best_lines[0]
            line_totals[line.id] = line_totals.get(line.id, Decimal("0")) + amount
        else:
            key = (category, expense.room_id, expense.stage_id)
            fallback_totals[key] = fallback_totals.get(key, Decimal("0")) + amount

    lines_by_id = {line.id: line for line in active_lines}
    for line_id, total in line_totals.items():
        lines_by_id[line_id].actual_amount = _money_float(total)

    used_markers: set[str] = set()
    for (category, room_id, stage_id), total in fallback_totals.items():
        if total == 0:
            continue
        marker = _system_actual_marker(category, room_id, stage_id)
        used_markers.add(marker)
        line = system_lines.get(marker)
        if line is None:
            line = BudgetLine(
                project_id=project_id,
                room_id=room_id,
                stage_id=stage_id,
                category=category,
                description=f"{marker} Факт без точной строки сметы",
                planned_amount=0,
                actual_amount=0,
                expense_type=category,
                status="active",
            )
            db.add(line)
            system_lines[marker] = line
        line.room_id = room_id
        line.stage_id = stage_id
        line.category = category
        line.description = f"{marker} Факт без точной строки сметы"
        line.planned_amount = 0
        line.actual_amount = _money_float(total)
        line.expense_type = category
        line.status = "active"

    for marker, line in system_lines.items():
        if marker not in used_markers:
            await db.delete(line)

    projected_total = sum(line_totals.values(), Decimal("0")) + sum(
        fallback_totals.values(), Decimal("0")
    )
    if _money(projected_total) != _money(expected_total):
        raise RuntimeError("budget_actual_projection_mismatch")

    project = await db.get(Project, project_id)
    if project:
        project.budget_spent = _money_float(
            sum(
                (_money(expense.amount) for expense in expenses if expense.status == "confirmed"),
                Decimal("0"),
            )
        )
    await db.flush()


async def refresh_budget_facts(db: AsyncSession, project_id: str) -> None:
    """Run source hydration, then replace ambiguous legacy actuals with a one-expense-one-line projection."""
    await _ORIGINAL_REFRESH_BUDGET_FACTS(db, project_id)
    await _reconcile_budget_line_actuals(db, project_id)


# Legacy functions resolve their globals at call time. Installing protected implementations
# keeps budget_summary/update/delete and every existing caller on one integrity path.
_legacy.sync_budget_lines_from_estimate = sync_budget_lines_from_estimate
_legacy._dedupe_linked_expenses = _dedupe_linked_expenses
_legacy.expense_from_receipt = expense_from_receipt
_legacy.expense_from_payment = expense_from_payment
_legacy._purge_stale_purchase_expenses = _purge_stale_purchase_expenses
_legacy.expense_from_purchase = expense_from_purchase
_legacy.refresh_budget_facts = refresh_budget_facts