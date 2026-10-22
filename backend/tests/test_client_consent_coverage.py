"""Customer-only evidence coverage: no false financial consent, no hidden orphan links."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import hashlib
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import approvals as approvals_api
from app.models.client_scope_consent import (
    ClientScopeDecision, ClientScopeVersion, ClientFinancialAuthorization,
)
from app.models.entities import (
    Room, ChangeOrder, ChangeOrderStatus, DomainOutbox, Expense, MaterialPick,
    MaterialPickStatus, Payment, PaymentStatus, PaymentType, Project,
    Purchase, PurchaseItem, Receipt, User, UserRole, WorkOrder, WorkOrderStatus,
)
from app.services.client_consent_coverage_service import consent_coverage_snapshot


async def _seed(db, tag: str):
    customer = User(id=f"consent-c-{tag}", phone="+79070000401", role=UserRole.customer)
    contractor = User(id=f"consent-e-{tag}", phone="+79070000402", role=UserRole.contractor)
    other = User(id=f"consent-o-{tag}", phone="+79070000403", role=UserRole.contractor)
    project = Project(
        id=f"consent-p-{tag}", name="Customer consent audit", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_spent=136.9,
    )
    foreign = Project(
        id=f"consent-foreign-{tag}", name="Another object", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=other.id,
    )
    db.add_all([customer, contractor, other])
    await db.flush()
    db.add_all([project, foreign])
    await db.commit()
    return customer, contractor, other, project, foreign


@pytest.mark.asyncio
async def test_audit_separates_payment_from_consent_and_detects_foreign_links(db):
    customer, contractor, _, project, foreign = await _seed(db, "mixed")
    order = ChangeOrder(
        id="consent-change-mixed", project_id=project.id, title="Доп. работы",
        amount=200, status=ChangeOrderStatus.approved, created_by=contractor.id,
    )
    pick = MaterialPick(
        id="consent-pick-mixed", project_id=project.id, name="Краска",
        qty=2, price=5, unit="л", status=MaterialPickStatus.approved,
    )
    db.add_all([order, pick])
    await db.flush()
    payment = Payment(
        id="consent-payment-mixed", project_id=project.id,
        payment_type=PaymentType.advance, status=PaymentStatus.confirmed,
        title="Счёт по доп. работам", amount=100, created_by=contractor.id,
        change_order_id=order.id,
    )
    foreign_payment = Payment(
        id="consent-payment-foreign", project_id=foreign.id,
        payment_type=PaymentType.advance, status=PaymentStatus.confirmed,
        title="Чужой платёж", amount=10, created_by=contractor.id,
    )
    purchase = Purchase(
        id="consent-purchase-mixed", project_id=project.id,
        supplier_name="Магазин", total_amount=10,
    )
    work = WorkOrder(
        id="consent-work-mixed", project_id=project.id, title="Покраска",
        work_type="painting", status=WorkOrderStatus.approved,
        budget_planned=200, created_by=contractor.id,
    )
    db.add_all([payment, foreign_payment, purchase, work])
    await db.flush()
    db.add(PurchaseItem(
        id="consent-item-mixed", purchase_id=purchase.id,
        material_pick_id=pick.id, name="Краска",
        qty=2, unit="л", unit_price=5,
    ))
    db.add_all([
        Expense(
            id="consent-exp-payment", project_id=project.id,
            payment_id=payment.id, title="Платёж", category="works",
            status="confirmed", amount=100,
        ),
        Expense(
            id="consent-exp-manual", project_id=project.id, title="Без источника",
            category="other", status="confirmed", amount=25,
        ),
        Expense(
            id="consent-exp-foreign", project_id=project.id,
            payment_id=foreign_payment.id, title="Ошибочная чужая связь",
            category="works", status="confirmed", amount=11.9,
        ),
        Expense(
            id="consent-exp-purchase", project_id=project.id,
            purchase_id=purchase.id, title="Товар", category="materials",
            status="disputed", amount=10,
        ),
    ])
    await db.commit()

    outbox_before = await db.scalar(select(func.count()).select_from(DomainOutbox))
    snapshot = await consent_coverage_snapshot(db, project)
    assert snapshot["coverage"] == "advisory_not_a_payment_authorization"
    assert snapshot["complete_customer_consent_proven"] is False
    assert snapshot["financial_totals_are_not_additive"] is True
    assert snapshot["read_consistency"] == "best_effort_not_an_atomic_snapshot"
    assert snapshot["recognized_expense_fact_rub"] == "136.90"
    assert snapshot["budget_comparison"] == "provisional_match"
    assert snapshot["budget_drift_rub"] == "0.00"
    assert snapshot["counts"] == {
        "payments":1, "expenses":4, "purchases":1, "work_orders":1,
        "change_orders":1,
    }
    assert snapshot["source_integrity_issues"] == 1
    assert snapshot["items_requiring_evidence"] == snapshot["total_scanned"]
    by_id = {item["id"]:item for item in snapshot["items"]}
    assert by_id["consent-payment-mixed"]["evidence_level"] == "partial"
    assert by_id["consent-payment-mixed"]["consent_status"] == "not_verifiable"
    assert by_id["consent-exp-foreign"]["evidence_level"] == "broken"
    assert by_id["consent-exp-foreign"]["risk"] == "critical"
    assert by_id["consent-exp-foreign"]["references"]["payment_id"] is None
    assert "payment" in by_id["consent-exp-foreign"]["references"]["foreign_or_missing_source_types"]
    assert by_id["consent-exp-manual"]["evidence_level"] == "missing"
    assert by_id["consent-work-mixed"]["references"]["missing_details"] == [
        "named_specialist", "dates", "scope_location",
        "structured_quantity_unit", "explicit_inclusions_exclusions",
        "payment_milestone",
    ]
    assert by_id["consent-purchase-mixed"]["evidence_level"] == "partial"
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == outbox_before
    assert (await db.get(Project, project.id)).budget_spent == 136.9


@pytest.mark.asyncio
async def test_customer_coverage_route_denies_contractor_and_cross_project_user(db):
    customer, contractor, outsider, project, _ = await _seed(db, "acl")
    response = await approvals_api.customer_consent_coverage(
        project.id, user=customer, db=db,
    )
    assert response["project_id"] == project.id
    assert response["counts"]["payments"] == 0
    assert response["complete_customer_consent_proven"] is False
    # Diagnostic must highlight cached financial totals without matching sources,
    # not mutate them to produce a seemingly clean financial result.
    assert response["budget_comparison"] == "provisional_mismatch"
    assert response["budget_drift_rub"] == "-136.90"
    for actor in (contractor, outsider):
        with pytest.raises(HTTPException) as caught:
            await approvals_api.customer_consent_coverage(project.id, user=actor, db=db)
        assert caught.value.status_code in {403, 404}
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_audit_checks_all_source_links_not_only_first(db):
    customer, contractor, _, project, foreign = await _seed(db, "sources")
    payment = Payment(
        id="consent-sources-payment", project_id=project.id,
        payment_type=PaymentType.advance, status=PaymentStatus.confirmed,
        title="Законный счёт", amount=50, created_by=contractor.id,
    )
    foreign_receipt = Receipt(
        id="consent-sources-receipt", project_id=foreign.id, amount=50,
    )
    db.add_all([payment, foreign_receipt])
    await db.flush()
    db.add(Expense(
        id="consent-sources-expense", project_id=project.id,
        payment_id=payment.id, receipt_id=foreign_receipt.id,
        title="Оплата с чужим чеком", category="works", amount=50,
        status="confirmed",
    ))
    await db.commit()
    snapshot = await consent_coverage_snapshot(db, project)
    expense = next(item for item in snapshot["items"] if item["kind"] == "expense")
    assert expense["evidence_level"] == "broken"
    assert expense["references"]["source_type"] == "broken_receipt"
    assert expense["references"]["payment_id"] == payment.id
    assert expense["references"]["receipt_id"] is None
    assert expense["references"]["foreign_or_missing_source_types"] == ["receipt"]
    assert snapshot["source_integrity_issues"] == 1


@pytest.mark.asyncio
async def test_non_rub_expense_is_not_reported_or_summed_as_rub(db):
    _, _, _, project, _ = await _seed(db, "foreign-currency")
    db.add(Expense(
        id="consent-fx-expense", project_id=project.id,
        title="Currency requires reconciliation", category="materials",
        status="confirmed", amount=15.5, currency="USD",
    ))
    await db.commit()

    snapshot = await consent_coverage_snapshot(db, project)
    expense = next(item for item in snapshot["items"] if item["kind"] == "expense")
    assert expense["evidence_level"] == "broken"
    assert expense["risk"] == "critical"
    assert expense["reason_code"] == "expense_currency_requires_reconciliation"
    assert expense["amount_rub"] is None
    assert expense["references"]["original_currency"] == "USD"
    assert expense["references"]["original_amount"] == "15.50"
    assert snapshot["recognized_expense_fact_rub"] is None
    assert snapshot["budget_comparison"] == "unverifiable"
    assert snapshot["budget_drift_rub"] is None
    assert snapshot["source_integrity_issues"] == 1


@pytest.mark.asyncio
async def test_scope_decision_evidence_links_to_work_but_never_auto_authorizes_payments(db):
    customer, contractor, _, project, _ = await _seed(db, "version-link")
    room = Room(
        id="consent-room-version-link", project_id=project.id,
        name="Спальня", room_type="living", length_m=4, width_m=4,
        height_m=2.7, openings_sq_m=0, outlets_count=0,
        switches_count=0, plumbing_points=0,
    )
    db.add(room)
    await db.flush()
    work = WorkOrder(
        id="consent-work-version-link", project_id=project.id,
        title="Покраска 2 м²", work_type="painting",
        room_id=room.id, status=WorkOrderStatus.approved,
        budget_planned=5000, assignee_id=contractor.id,
        created_by=contractor.id, notes="Грунт включён",
        planned_start=date(2026, 11, 1),
        planned_end=date(2026, 11, 4),
    )
    db.add(work)
    await db.flush()
    snapshot = {
        "schema": "renova.customer_scope.v1", "version": 1,
        "work_order": {
            "id": work.id, "project_id": project.id,
            "title": work.title, "work_type": work.work_type,
            "room_id": work.room_id, "stage_id": work.stage_id,
            "planned_start": "2026-11-01", "planned_end": "2026-11-04",
            "assignee_id": contractor.id,
            "budget_planned_rub": "5000.00", "notes": "Грунт включён",
        },
        "terms": {
            "specialist_id": contractor.id,
            "quantity": "2.000", "unit": "м²",
            "unit_price_rub": "2500.00", "amount_cap_rub": "5000.00",
            "currency": "RUB",
            "inclusions": ["Грунт"], "exclusions": ["Вывоз мусора"],
            "deliverables": ["Покрашенная стена"],
            "payment_milestone": "После приёмки",
        },
    }
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    version = ClientScopeVersion(
        project_id=project.id, work_order_id=work.id, version=1,
        created_by=contractor.id, client_request_id="scope-version-link-001",
        work_order_updated_at=work.updated_at or datetime(2026, 10, 23),
        snapshot_json=encoded, snapshot_sha256=digest,
        specialist_id=contractor.id, quantity=Decimal("2.000"),
        unit="м²", unit_price=Decimal("2500.00"),
        amount_cap=Decimal("5000.00"), currency="RUB",
    )
    db.add(version)
    await db.flush()
    decision = ClientScopeDecision(
        project_id=project.id, scope_version_id=version.id,
        customer_id=customer.id, reviewed_digest=digest, decision="approved",
    )
    db.add(decision)
    await db.flush()
    grant = ClientFinancialAuthorization(
        project_id=project.id, scope_version_id=version.id,
        decision_id=decision.id, customer_id=customer.id,
        amount_cap=Decimal("5000.00"),
        committed_amount=Decimal("0.00"),
        consumed_amount=Decimal("0.00"), currency="RUB",
    )
    db.add(grant)
    await db.commit()

    result = await consent_coverage_snapshot(db, project)
    work_entry = next(item for item in result["items"] if item["kind"] == "work_order")
    assert work_entry["reason_code"] == "scope_approved_payments_not_allocated"
    assert work_entry["evidence_level"] == "partial"
    assert work_entry["consent_status"] == "not_verifiable"
    assert work_entry["references"]["scope_version"] == 1
    assert work_entry["references"]["scope_approved"] is True
    assert work_entry["references"]["financial_allocations_enforced"] is False
    assert work_entry["references"]["scope_cap_rub"] == "5000.00"
    assert work_entry["references"]["missing_details"] == []
    assert result["complete_customer_consent_proven"] is False
    assert result["items_requiring_evidence"] == 1

    # Even direct DB-level drift of an already accepted work price must not
    # be reported as unchanged customer consent, despite an intact hash.
    work.budget_planned = 5000.01
    await db.commit()
    changed_work = await consent_coverage_snapshot(db, project)
    changed_item = next(item for item in changed_work["items"] if item["kind"] == "work_order")
    assert changed_item["evidence_level"] == "broken"
    assert changed_item["reason_code"] == "scope_snapshot_integrity_failed"
    assert changed_work["complete_customer_consent_proven"] is False

    work.budget_planned = 5000
    await db.commit()
    # A changed snapshot must revoke diagnostic confidence even if a historic
    # decision and cap still exist. The audit does not mutate or repair it.
    version.snapshot_json = encoded + " "
    await db.commit()
    drift = await consent_coverage_snapshot(db, project)
    broken = next(item for item in drift["items"] if item["kind"] == "work_order")
    assert broken["evidence_level"] == "broken"
    assert broken["reason_code"] == "scope_snapshot_integrity_failed"
    assert drift["source_integrity_issues"] == 1
    assert drift["complete_customer_consent_proven"] is False
