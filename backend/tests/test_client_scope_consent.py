"""Exact-version client scope consent, negative authorization and atomic evidence."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1 import client_scope_consents as scope_api
from app.models.client_scope_consent import (
    ClientFinancialAuthorization, ClientScopeDecision, ClientScopeVersion,
)
from app.models.entities import (
    DomainOutbox, Expense, Payment, Project, Room, User, UserRole,
    WorkOrder, WorkOrderStatus,
)
from app.services import client_scope_consent_service as scopes
from app.services import work_order_service


async def _seed(db, tag: str):
    customer = User(id=f"cs-c-{tag}", phone="+79013123401", role=UserRole.customer, full_name="Заказчик Иванов")
    contractor = User(id=f"cs-e-{tag}", phone="+79013123402", role=UserRole.contractor, full_name="Мастер Петров")
    outsider = User(id=f"cs-o-{tag}", phone="+79013123403", role=UserRole.customer)
    project = Project(
        id=f"cs-project-{tag}", customer_id=customer.id,
        contractor_id=contractor.id, name="Согласованная отделка",
        renovation_type="cosmetic",
    )
    room = Room(
        id=f"cs-room-{tag}", project_id=project.id,
        name="Спальня", room_type="living",
        length_m=4, width_m=4, height_m=2.7, openings_sq_m=0,
        outlets_count=0, switches_count=0, plumbing_points=0,
    )
    db.add_all([customer, contractor, outsider])
    await db.flush()
    db.add(project)
    await db.flush()
    db.add(room)
    await db.flush()
    work = WorkOrder(
        id=f"cs-work-{tag}", project_id=project.id,
        room_id=room.id, work_type="painting", title="Покраска 2 м²",
        status=WorkOrderStatus.published,
        planned_start=date(2026, 11, 1),
        planned_end=date(2026, 11, 4),
        budget_planned=5000.0,
        assignee_id=contractor.id, created_by=contractor.id,
        notes="Грунт включён, вывоз мусора отдельно",
    )
    db.add(work)
    await db.commit()
    await db.refresh(work)
    return customer, contractor, outsider, project, work


def _fields(work: WorkOrder, **changed):
    form = {
        "expected_updated_at":work.updated_at,
        "client_request_id":"customer-scope-iteration-01",
        "specialist_id":work.assignee_id,
        "quantity":"2.000",
        "unit":"м²",
        "unit_price":"2500.00",
        "amount_cap":"5000.00",
        "inclusions":["Покраска 2 м²", "Грунтование"],
        "exclusions":["Вывоз мусора", "Дополнительная шпаклёвка"],
        "deliverables":["Покрашенная стена", "Фото и приёмка"],
        "payment_milestone":"Оплата после приёмки объёма",
        "risks":["Скрытая влажность требует отдельного предложения"],
    }
    form.update(changed)
    return form


@pytest.mark.asyncio
async def test_customer_approves_exact_digest_and_receives_unspent_cap_not_payment(db):
    customer, contractor, _, project, work = await _seed(db, "positive")
    proposed = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    assert proposed["replayed"] is False
    assert proposed["version"] == 1
    assert proposed["snapshot"]["work_order"]["budget_planned_rub"] == "5000.00"
    assert proposed["snapshot"]["terms"]["inclusions"] == ["Покраска 2 м²", "Грунтование"]
    assert proposed["snapshot"]["terms"]["specialist_name"] == "Мастер Петров"
    assert len(proposed["digest"]) == 64

    granted = await scopes.decide_scope(
        db, project=project, scope_version_id=proposed["id"],
        actor=customer, digest=proposed["digest"], decision="approved",
    )
    assert granted["replayed"] is False
    assert granted["authorization_id"]
    authority = await db.get(ClientFinancialAuthorization, granted["authorization_id"])
    assert authority.customer_id == customer.id
    assert authority.amount_cap == Decimal("5000.00")
    assert authority.committed_amount == Decimal("0.00")
    assert authority.consumed_amount == Decimal("0.00")
    assert await db.scalar(select(func.count()).select_from(ClientScopeDecision)) == 1
    assert await db.scalar(select(func.count()).select_from(Payment)) == 0
    assert await db.scalar(select(func.count()).select_from(Expense)) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 4

    listed = await scopes.list_scope_versions(db, project_id=project.id)
    assert listed[0]["decision"] == "approved"
    assert listed[0]["authorization"]["linked_payments_qualified"] is False
    assert listed[0]["authorization"]["cap_rub"] == "5000.00"

    replay = await scopes.decide_scope(
        db, project=project, scope_version_id=proposed["id"],
        actor=customer, digest=proposed["digest"], decision="approved",
    )
    assert replay["replayed"] is True
    assert replay["authorization_id"] == granted["authorization_id"]
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 4


@pytest.mark.asyncio
async def test_foreign_customer_or_contractor_cannot_manufacture_approval(db):
    customer, contractor, outsider, project, work = await _seed(db, "roles")
    proposed = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    for actor in (contractor, outsider):
        with pytest.raises(ValueError, match="scope_decision_customer_required"):
            await scopes.decide_scope(
                db, project=project, scope_version_id=proposed["id"],
                actor=actor, digest=proposed["digest"], decision="approved",
            )
    with pytest.raises(ValueError, match="scope_proposal_contractor_required"):
        await scopes.propose_scope(
            db, project=project, work_order_id=work.id, actor=outsider,
            **_fields(work, client_request_id="outsider-intent-123"),
        )
    assert await db.scalar(select(func.count()).select_from(ClientScopeDecision)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientFinancialAuthorization)) == 0

    # The API verifies exact project ownership even when the global user role
    # equals customer: project membership ≠ signature authorization.
    with pytest.raises(HTTPException) as denied:
        await scope_api.decide_scope(
            project.id, proposed["id"], scope_api.ScopeDecisionIn(
                decision="approved", digest=proposed["digest"],
            ), user=outsider, db=db,
        )
    assert denied.value.status_code in (403, 404)


@pytest.mark.asyncio
async def test_duplicate_request_is_replay_only_and_change_is_409(db):
    _, contractor, _, project, work = await _seed(db, "idempotency")
    first = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    again = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    assert again["replayed"] and again["id"] == first["id"]
    assert await db.scalar(select(func.count()).select_from(ClientScopeVersion)) == 1

    with pytest.raises(ValueError, match="scope_request_conflict"):
        await scopes.propose_scope(
            db, project=project, work_order_id=work.id, actor=contractor,
            **_fields(work, unit="шт"),
        )
    assert await db.scalar(select(func.count()).select_from(ClientScopeVersion)) == 1


@pytest.mark.asyncio
async def test_superseded_version_bad_digest_and_rejected_decision_fail_closed(db):
    customer, contractor, _, project, work = await _seed(db, "supersession")
    first = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    second = await scopes.propose_scope(
        db, project=project, work_order_id=work.id, actor=contractor,
        **_fields(work, client_request_id="customer-scope-iteration-02",
                  risks=["Проверить поверхность до покраски"]),
    )
    assert second["version"] == 2
    with pytest.raises(ValueError, match="scope_version_superseded"):
        await scopes.decide_scope(
            db, project=project, scope_version_id=first["id"],
            actor=customer, digest=first["digest"], decision="approved",
        )
    with pytest.raises(ValueError, match="scope_digest_mismatch"):
        await scopes.decide_scope(
            db, project=project, scope_version_id=second["id"],
            actor=customer, digest="f" * 64, decision="approved",
        )
    rejected = await scopes.decide_scope(
        db, project=project, scope_version_id=second["id"],
        actor=customer, digest=second["digest"], decision="rejected",
        reason="Нужны измерения и гарантия",
    )
    assert rejected["authorization_id"] is None
    with pytest.raises(ValueError, match="scope_decision_final_conflict"):
        await scopes.decide_scope(
            db, project=project, scope_version_id=second["id"],
            actor=customer, digest=second["digest"], decision="approved",
        )
    assert await db.scalar(select(func.count()).select_from(ClientFinancialAuthorization)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientScopeDecision)) == 1


@pytest.mark.asyncio
async def test_stale_work_budget_and_changed_scope_do_not_create_consent(db):
    customer, contractor, _, project, work = await _seed(db, "stale")
    with pytest.raises(ValueError, match="scope_work_budget_mismatch"):
        await scopes.propose_scope(
            db, project=project, work_order_id=work.id, actor=contractor,
            **_fields(work, unit_price="2700.00", amount_cap="5400.00"),
        )
    await db.rollback()
    work = await db.get(WorkOrder, work.id)
    project = await db.get(Project, project.id)
    first = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    previous_hash = first["digest"]
    changed = await work_order_service.update_work_order(
        db, work, {"planned_end":date(2026, 11, 6)},
        expected_updated_at=work.updated_at, actor_id=contractor.id,
        project=project,
    )
    assert changed.updated_at.isoformat() != first["snapshot"]["work_order"]["updated_at"]
    with pytest.raises(ValueError, match="scope_stale_work_order"):
        await scopes.decide_scope(
            db, project=project, scope_version_id=first["id"],
            actor=customer, digest=first["digest"], decision="approved",
        )
    assert await db.scalar(select(func.count()).select_from(ClientScopeDecision)) == 0
    snapshot = await db.get(ClientScopeVersion, first["id"])
    assert snapshot.snapshot_sha256 == previous_hash


@pytest.mark.asyncio
async def test_exact_money_no_rounding_and_required_exclusions(db):
    _, contractor, _, project, work = await _seed(db, "money")
    cases = (
        ("scope_quantity_price_cap_mismatch", dict(
            quantity="2.000", unit_price="2500.00", amount_cap="5000.01"
        )),
        ("scope_unit_price_invalid", dict(unit_price="2500.001")),
        ("scope_quantity_invalid", dict(quantity="2.0001")),
        ("scope_inclusions_invalid", dict(inclusions=[])),
        ("scope_payment_milestone_invalid", dict(payment_milestone=" ")),
    )
    for message, override in cases:
        with pytest.raises(ValueError, match=message):
            await scopes.propose_scope(
                db, project=project, work_order_id=work.id,
                actor=contractor, **_fields(work, **override),
            )
    assert await db.scalar(select(func.count()).select_from(ClientScopeVersion)) == 0


@pytest.mark.asyncio
async def test_outbox_failure_rolls_back_proposal_and_decision(db, monkeypatch):
    customer, contractor, _, project, work = await _seed(db, "rollback")
    from app.services import client_scope_consent_service as service

    async def fail(*_args, **_kwargs):
        raise RuntimeError("synthetic_outbox_failure")

    original = service.outbox.enqueue
    monkeypatch.setattr(service.outbox, "enqueue", fail)
    with pytest.raises(RuntimeError, match="synthetic_outbox_failure"):
        await scopes.propose_scope(
            db, project=project, work_order_id=work.id,
            actor=contractor, **_fields(work),
        )
    assert await db.scalar(select(func.count()).select_from(ClientScopeVersion)) == 0
    monkeypatch.setattr(service.outbox, "enqueue", original)
    proposed = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    monkeypatch.setattr(service.outbox, "enqueue", fail)
    with pytest.raises(RuntimeError, match="synthetic_outbox_failure"):
        await scopes.decide_scope(
            db, project=project, scope_version_id=proposed["id"],
            actor=customer, digest=proposed["digest"], decision="approved",
        )
    assert await db.scalar(select(func.count()).select_from(ClientScopeDecision)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientFinancialAuthorization)) == 0


@pytest.mark.asyncio
async def test_db_enforces_authorization_limits_beyond_service(db):
    customer, contractor, _, project, work = await _seed(db, "constraints")
    proposed = await scopes.propose_scope(
        db, project=project, work_order_id=work.id,
        actor=contractor, **_fields(work),
    )
    approved = await scopes.decide_scope(
        db, project=project, scope_version_id=proposed["id"],
        actor=customer, digest=proposed["digest"], decision="approved",
    )
    auth = await db.get(ClientFinancialAuthorization, approved["authorization_id"])
    auth.committed_amount = Decimal("5000.01")
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    auth = await db.get(ClientFinancialAuthorization, approved["authorization_id"])
    assert auth.committed_amount == Decimal("0.00")
