"""Read-only, fail-honest customer consent coverage diagnostic.

This is NOT an authorization ledger and never certifies client approval.
A provider settlement, an approved stage or a signed estimate is not by itself
proof that a particular amount/specialist/quantity has prior informed consent.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    ChangeOrder, ChangeOrderStatus, Expense, MaterialPick, MaterialPickStatus,
    Payment, Project, Purchase, PurchaseItem, Receipt, Stage, WorkOrder,
    WorkOrderStatus,
)

SCAN_LIMIT = 1000
LIST_LIMIT = 120
_CENT = Decimal("0.01")
_CLOSED_PAYMENT_STATUSES = {"cancelled", "refunded"}
_COMMITTED_WORK_STATUSES = {"approved", "in_progress", "review", "done", "paid"}


def _state(value: object) -> str:
    return str(value.value if hasattr(value, "value") else value)


def _money(value: object) -> str:
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount != amount.quantize(_CENT):
            return "invalid"
        return str(amount.quantize(_CENT))
    except (InvalidOperation, TypeError, ValueError):
        return "invalid"


async def _project_rows(db: AsyncSession, model, project_id: str):
    result = await db.execute(
        select(model).where(model.project_id == project_id)
        .order_by(model.id)
        .limit(SCAN_LIMIT + 1)
    )
    rows = list(result.scalars().all())
    return rows[:SCAN_LIMIT], len(rows) > SCAN_LIMIT


def _entry(kind: str, row, *, status: str, evidence: str,
           risk: str, reason: str, amount: object | None = None,
           currency: str = "RUB", references: dict | None = None) -> dict:
    return {
        "kind": kind,
        "id": row.id,
        "title": (getattr(row, "title", None) or getattr(row, "name", None)
                  or getattr(row, "supplier_name", None) or kind),
        "status": status,
        # Never relabel a non-RUB amount as RUB or silently sum FX balances.
        "amount_rub": _money(amount) if amount is not None and currency == "RUB" else None,
        "consent_status": "not_verifiable",
        "evidence_level": evidence,
        "risk": risk,
        "reason_code": reason,
        "references": references or {},
    }


async def consent_coverage_snapshot(db: AsyncSession, project: Project) -> dict:
    """Identify missing evidence, without modifying budget rows or acknowledging money.

    The absence of a new universal consent ledger means no row can be presented
    as *fully* authorized by this diagnostic. Partial workflow evidence is
    distinguished from authenticated, version-bound financial authorization.
    """
    project_id = project.id
    payments, p_cut = await _project_rows(db, Payment, project_id)
    expenses, e_cut = await _project_rows(db, Expense, project_id)
    purchases, u_cut = await _project_rows(db, Purchase, project_id)
    work_orders, w_cut = await _project_rows(db, WorkOrder, project_id)
    changes, c_cut = await _project_rows(db, ChangeOrder, project_id)
    stages, s_cut = await _project_rows(db, Stage, project_id)
    picks, m_cut = await _project_rows(db, MaterialPick, project_id)
    receipts, r_cut = await _project_rows(db, Receipt, project_id)

    payment_by_id = {p.id: p for p in payments}
    purchase_by_id = {p.id: p for p in purchases}
    receipt_by_id = {r.id: r for r in receipts}
    stage_by_id = {s.id: s for s in stages}
    pick_by_id = {m.id: m for m in picks}
    change_by_id = {c.id: c for c in changes}
    ids = [p.id for p in purchases]
    purchase_items = (
        list((await db.execute(
            select(PurchaseItem).where(PurchaseItem.purchase_id.in_(ids))
            .order_by(PurchaseItem.id)
            .limit(SCAN_LIMIT + 1)
        )).scalars().all())
        if ids else []
    )
    items_truncated = len(purchase_items) > SCAN_LIMIT
    items_by_purchase: dict[str, list[PurchaseItem]] = {}
    for item in purchase_items[:SCAN_LIMIT]:
        items_by_purchase.setdefault(item.purchase_id, []).append(item)

    entries = []
    source_integrity_issues = 0
    actual_expense_fact = Decimal("0.00")
    actual_expense_fact_valid = True

    for payment in payments:
        status = _state(payment.status)
        order = change_by_id.get(payment.change_order_id) if payment.change_order_id else None
        stage = stage_by_id.get(payment.stage_id) if payment.stage_id else None
        if payment.change_order_id and order is None:
            evidence, risk, reason = "broken", "high", "change_order_outside_project"
        elif order is not None and order.status == ChangeOrderStatus.approved:
            evidence, risk, reason = "partial", "medium", "approved_change_without_itemized_consent"
        elif payment.stage_id and stage is None:
            evidence, risk, reason = "broken", "high", "stage_outside_project"
        elif stage is not None and stage.customer_accepted_at:
            evidence, risk, reason = "partial", "medium", "stage_accepted_not_prior_payment_consent"
        else:
            evidence, risk, reason = "missing", "high", "no_version_bound_payment_consent"
        if status in _CLOSED_PAYMENT_STATUSES and risk != "high":
            risk = "low"
        entries.append(_entry(
            "payment", payment, status=status, evidence=evidence,
            risk=risk, reason=reason, amount=payment.amount,
            references={"stage_id":payment.stage_id, "change_order_id":payment.change_order_id},
        ))
        if evidence == "broken":
            source_integrity_issues += 1

    for expense in expenses:
        # Check *every* populated source field. Otherwise a valid payment link
        # could conceal an additional foreign-project receipt/purchase binding.
        source_refs = (
            ("payment", expense.payment_id, payment_by_id),
            ("receipt", expense.receipt_id, receipt_by_id),
            ("purchase", expense.purchase_id, purchase_by_id),
            ("material_pick", expense.material_pick_id, pick_by_id),
        )
        present = [kind for kind, key, _ in source_refs if key]
        invalid = [kind for kind, key, known in source_refs if key and key not in known]
        if invalid:
            source = "broken_" + ",".join(invalid)
            evidence, risk, reason = "broken", "critical", "financial_source_cross_project_or_missing"
            source_integrity_issues += 1
        elif present:
            source = "+".join(present)
            evidence, risk, reason = "partial", "medium", "source_link_not_customer_consent"
        elif (expense.comment or "").startswith("bank_statement:v1:"):
            source = "external_bank_statement"
            evidence, risk, reason = "missing", "high", "customer_consent_and_source_not_attested"
        else:
            source = "manual_unlinked"
            evidence, risk, reason = "missing", "high", "customer_consent_and_source_not_attested"
        currency = str(expense.currency or "").strip().upper()
        currency_conflict = currency != "RUB"
        if currency_conflict:
            # Retain the evidence and native amount, but never present it as RUB.
            if evidence != "broken":
                source_integrity_issues += 1
            evidence, risk, reason = "broken", "critical", "expense_currency_requires_reconciliation"
        status = _state(expense.status)
        if status == "confirmed":
            money = _money(expense.amount)
            if money == "invalid" or currency_conflict:
                actual_expense_fact_valid = False
                if money == "invalid" and not currency_conflict:
                    if evidence != "broken":
                        source_integrity_issues += 1
                    evidence, risk, reason = "broken", "critical", "financial_amount_invalid"
            else:
                actual_expense_fact += Decimal(money)
        entries.append(_entry(
            "expense", expense, status=status, evidence=evidence,
            risk=risk, reason=reason, amount=expense.amount, currency=currency,
            references={
                "source_type": source,
                # Never disclose an out-of-project source identifier even when
                # a broken FK scalar appears on a customer-visible Expense.
                "payment_id": expense.payment_id if expense.payment_id in payment_by_id else None,
                "receipt_id": expense.receipt_id if expense.receipt_id in receipt_by_id else None,
                "purchase_id": expense.purchase_id if expense.purchase_id in purchase_by_id else None,
                "foreign_or_missing_source_types": invalid,
                "original_currency": currency,
                "original_amount": _money(expense.amount),
            },
        ))

    for purchase in purchases:
        items = items_by_purchase.get(purchase.id, [])
        valid_picks = bool(items) and all(
            item.material_pick_id in pick_by_id
            and pick_by_id[item.material_pick_id].status in (
                MaterialPickStatus.approved, MaterialPickStatus.purchased
            )
            and _money(item.unit_price) == _money(pick_by_id[item.material_pick_id].price)
            for item in items
        )
        if items_truncated:
            evidence, risk, reason = "unknown", "high", "purchase_items_scan_incomplete"
        elif valid_picks:
            evidence, risk, reason = "partial", "medium", "approved_material_selection_not_purchase_consent"
        else:
            evidence, risk, reason = "missing", "high", "purchase_selection_or_price_evidence_missing"
        entries.append(_entry(
            "purchase", purchase, status=_state(purchase.status),
            evidence=evidence, risk=risk, reason=reason,
            amount=purchase.total_amount,
            references={"material_pick_count":len(items)},
        ))

    for work in work_orders:
        state = _state(work.status)
        missing = []
        if not work.assignee_id and project.contractor_id:
            missing.append("named_specialist")
        if work.planned_start is None or work.planned_end is None:
            missing.append("dates")
        if not work.room_id and not work.stage_id:
            missing.append("scope_location")
        if work.budget_planned is None:
            missing.append("priced_scope")
        # Current WorkOrder has no canonical structured quantity/unit, exclusion
        # list or payment-milestone consent. Notes cannot stand in for a signed
        # itemized version, so these remain universally unverified.
        missing.extend((
            "structured_quantity_unit",
            "explicit_inclusions_exclusions",
            "payment_milestone",
        ))
        evidence = "partial" if state in _COMMITTED_WORK_STATUSES else "missing"
        entries.append(_entry(
            "work_order", work, status=state, evidence=evidence,
            risk="high" if missing and state in _COMMITTED_WORK_STATUSES else "medium",
            reason="scope_version_and_customer_consent_snapshot_missing",
            amount=work.budget_planned,
            references={"missing_details":missing, "assignee_id":work.assignee_id,
                        "stage_id":work.stage_id, "room_id":work.room_id},
        ))

    for order in changes:
        entries.append(_entry(
            "change_order", order, status=_state(order.status),
            evidence="partial" if order.status == ChangeOrderStatus.approved else "missing",
            risk="medium" if order.status == ChangeOrderStatus.approved else "high",
            reason="change_order_lacks_quantity_specialist_and_scope_digest",
            amount=order.amount, references={"stage_id":order.stage_id},
        ))

    counts: dict[str, int] = {
        kind: len(rows) for kind, rows in (
            ("payments", payments), ("expenses", expenses), ("purchases", purchases),
            ("work_orders", work_orders), ("change_orders", changes),
        )
    }
    truncated = any((p_cut, e_cut, u_cut, w_cut, c_cut, s_cut, m_cut, r_cut, items_truncated))
    severity = {"critical":0, "high":1, "medium":2, "low":3}
    entries.sort(key=lambda entry:(severity[entry["risk"]],entry["kind"],entry["id"]))
    # An advisory drift signal is useful, but never treat this READ COMMITTED
    # scan as the authoritative PostgreSQL transaction boundary.
    cached_spend = _money(project.budget_spent)
    compare_safe = actual_expense_fact_valid and not e_cut and cached_spend != "invalid"
    budget_gap = (actual_expense_fact - Decimal(cached_spend)).quantize(_CENT) if compare_safe else None
    return {
        "project_id": project_id,
        "as_of_utc": datetime.now(timezone.utc).isoformat(),
        "coverage": "advisory_not_a_payment_authorization",
        "read_consistency": "best_effort_not_an_atomic_snapshot",
        "complete_customer_consent_proven": False,
        "scan_truncated": truncated,
        "total_scanned": sum(counts.values()),
        "counts": counts,
        "source_integrity_issues": source_integrity_issues,
        # "Partial" provenance still cannot prove this customer's authorization.
        # Count every scanned record until a versioned consent ledger is present.
        "items_requiring_evidence": len(entries),
        "recognized_expense_fact_rub": (
            str(actual_expense_fact.quantize(_CENT))
            if actual_expense_fact_valid and not e_cut else None
        ),
        "project_cached_budget_spent_rub": cached_spend,
        "budget_comparison": (
            "unverifiable" if budget_gap is None else
            "provisional_match" if budget_gap == 0 else "provisional_mismatch"
        ),
        "budget_drift_rub": str(budget_gap) if budget_gap is not None else None,
        "financial_totals_are_not_additive": True,
        "amounts_are_not_proof_of_customer_consent": True,
        "items": entries[:LIST_LIMIT],
        "items_limited": len(entries) > LIST_LIMIT,
    }
