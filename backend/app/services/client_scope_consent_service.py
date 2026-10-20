"""Explicit customer decisions on versioned work scope, never inferred from payments.

This is the admission *foundation*. A newly approved authorization starts at zero
committed/consumed; the canonical Payment/Purchase/Expense writers DO NOT yet
reserve funds against it. Do not call this universal financial protection.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.client_scope_consent import (
    ClientFinancialAuthorization, ClientScopeDecision, ClientScopeVersion,
)
from app.models.entities import Project, User, WorkOrder, WorkOrderStatus
from app.services import outbox_service as outbox
from app.services import _work_order_service_core as work_core

_CENT = Decimal("0.01")
_MILL = Decimal("0.001")
_MAX = Decimal("99999999.99")
_PENDING_STATES = {WorkOrderStatus.published.value, WorkOrderStatus.negotiating.value}


def _decimal(value: object, *, quantum: Decimal, name: str) -> Decimal:
    try:
        d = Decimal(str(value))
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise ValueError(f"scope_{name}_invalid") from exc
    if not d.is_finite() or d <= 0 or d > _MAX or d != d.quantize(quantum):
        raise ValueError(f"scope_{name}_invalid")
    return d


def _dt(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _status(row: WorkOrder) -> str:
    return row.status.value if hasattr(row.status, "value") else str(row.status)


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(snapshot_json: str) -> str:
    return hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()


def _clean_text(value: str, *, max_length: int, field: str) -> str:
    text = value.strip()
    if not text or len(text) > max_length:
        raise ValueError(f"scope_{field}_invalid")
    return text


def _clean_lines(value: list[str], *, required: bool, name: str) -> list[str]:
    if (required and not value) or len(value) > 40:
        raise ValueError(f"scope_{name}_invalid")
    return [_clean_text(line, max_length=500, field=name) for line in value]


def _submitted_fields(
    *,
    expected_updated_at: datetime,
    specialist_id: str,
    quantity: object,
    unit: str,
    unit_price: object,
    amount_cap: object,
    inclusions: list[str],
    exclusions: list[str],
    deliverables: list[str],
    payment_milestone: str,
    risks: list[str],
) -> dict:
    qty = _decimal(quantity, quantum=_MILL, name="quantity")
    price = _decimal(unit_price, quantum=_CENT, name="unit_price")
    cap = _decimal(amount_cap, quantum=_CENT, name="amount_cap")
    # Refuse implicit rounding: the customer approves the exact numerical terms.
    if qty * price != cap:
        raise ValueError("scope_quantity_price_cap_mismatch")
    return {
        "expected_updated_at": _dt(expected_updated_at).isoformat(),
        "specialist_id": _clean_text(specialist_id, max_length=36, field="specialist"),
        "quantity": str(qty.quantize(_MILL)),
        "unit": _clean_text(unit, max_length=24, field="unit"),
        "unit_price_rub": str(price.quantize(_CENT)),
        "amount_cap_rub": str(cap.quantize(_CENT)),
        "currency": "RUB",
        "inclusions": _clean_lines(inclusions, required=True, name="inclusions"),
        "exclusions": _clean_lines(exclusions, required=False, name="exclusions"),
        "deliverables": _clean_lines(deliverables, required=True, name="deliverables"),
        "payment_milestone": _clean_text(
            payment_milestone, max_length=500, field="payment_milestone"
        ),
        "risks": _clean_lines(risks, required=False, name="risks"),
    }


async def _locked_work_order(
    db: AsyncSession, *, project_id: str, work_order_id: str,
) -> WorkOrder:
    q = select(WorkOrder).where(
        WorkOrder.id == work_order_id, WorkOrder.project_id == project_id
    ).with_for_update().execution_options(populate_existing=True)
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        raise ValueError("scope_work_order_not_found")
    return row


def _work_snapshot(work: WorkOrder) -> dict:
    return {
        "id": work.id,
        "project_id": work.project_id,
        "title": work.title,
        "work_type": work.work_type,
        "room_id": work.room_id,
        "stage_id": work.stage_id,
        "planned_start": work.planned_start.isoformat() if work.planned_start else None,
        "planned_end": work.planned_end.isoformat() if work.planned_end else None,
        "assignee_id": work.assignee_id,
        "budget_planned_rub": str(Decimal(str(work.budget_planned)).quantize(_CENT)),
        "notes": work.notes,
        "updated_at": _dt(work.updated_at).isoformat() if work.updated_at else None,
    }


def _proposal_result(row: ClientScopeVersion, *, replayed: bool = False) -> dict:
    stored = json.loads(row.snapshot_json)
    if _hash(row.snapshot_json) != row.snapshot_sha256:
        raise ValueError("scope_snapshot_integrity_failed")
    return {
        "id": row.id,
        "project_id": row.project_id,
        "work_order_id": row.work_order_id,
        "version": row.version,
        "snapshot": stored,
        "digest": row.snapshot_sha256,
        "amount_cap_rub": str(row.amount_cap),
        "replayed": replayed,
    }


async def propose_scope(
    db: AsyncSession,
    *, project: Project, work_order_id: str, actor: User,
    expected_updated_at: datetime, client_request_id: str,
    specialist_id: str, quantity: object, unit: str, unit_price: object,
    amount_cap: object, inclusions: list[str], exclusions: list[str],
    deliverables: list[str], payment_milestone: str, risks: list[str],
) -> dict:
    if actor.id != project.contractor_id:
        raise ValueError("scope_proposal_contractor_required")
    request_id = _clean_text(
        client_request_id, max_length=80, field="client_request_id"
    )
    form = _submitted_fields(
        expected_updated_at=expected_updated_at,
        specialist_id=specialist_id, quantity=quantity, unit=unit,
        unit_price=unit_price, amount_cap=amount_cap,
        inclusions=inclusions, exclusions=exclusions,
        deliverables=deliverables, payment_milestone=payment_milestone, risks=risks,
    )
    try:
        work = await _locked_work_order(
            db, project_id=project.id, work_order_id=work_order_id,
        )
        existing = (await db.execute(
            select(ClientScopeVersion).where(
                ClientScopeVersion.project_id == project.id,
                ClientScopeVersion.created_by == actor.id,
                ClientScopeVersion.client_request_id == request_id,
            )
        )).scalar_one_or_none()
        if existing:
            original = json.loads(existing.snapshot_json)
            stored = dict(original.get("terms") or {})
            stored.pop("specialist_name", None)  # derived from stored identity
            if existing.work_order_id != work.id or stored != form:
                raise ValueError("scope_request_conflict")
            return _proposal_result(existing, replayed=True)

        if _status(work) not in _PENDING_STATES:
            raise ValueError("scope_work_order_not_pending")
        if work.updated_at is None or _dt(work.updated_at) != _dt(expected_updated_at):
            raise ValueError("scope_stale_work_order")
        if not work.planned_start or not work.planned_end:
            raise ValueError("scope_work_dates_missing")
        if not work.room_id and not work.stage_id:
            raise ValueError("scope_location_missing")
        if work.assignee_id != specialist_id:
            raise ValueError("scope_specialist_mismatch")
        if specialist_id == project.customer_id:
            raise ValueError("scope_contractor_cannot_assign_customer")
        if not await work_core._is_project_executor(
            db, project=project, user_id=specialist_id,
        ):
            raise ValueError("scope_specialist_not_project_member")
        specialist = await db.get(User, specialist_id)
        if not specialist or specialist.deleted_at or not (specialist.full_name or "").strip():
            raise ValueError("scope_specialist_identity_incomplete")
        if Decimal(form["amount_cap_rub"]) != Decimal(str(work.budget_planned)):
            raise ValueError("scope_work_budget_mismatch")

        newest = (await db.execute(
            select(ClientScopeVersion).where(
                ClientScopeVersion.work_order_id == work.id,
                ClientScopeVersion.project_id == project.id,
            ).order_by(ClientScopeVersion.version.desc()).limit(1)
        )).scalar_one_or_none()
        if newest and (await db.scalar(
            select(ClientScopeDecision.id).where(
                ClientScopeDecision.scope_version_id == newest.id,
                ClientScopeDecision.decision == "approved",
            )
        )):
            raise ValueError("scope_already_authorized")

        version = newest.version + 1 if newest else 1
        snapshot = {
            "schema": "renova.customer_scope.v1",
            "version": version,
            "work_order": _work_snapshot(work),
            "terms": {**form, "specialist_name": specialist.full_name.strip()},
            "created_by": actor.id,
        }
        serialized = _json(snapshot)
        proposal = ClientScopeVersion(
            project_id=project.id, work_order_id=work.id,
            version=version, created_by=actor.id,
            client_request_id=request_id,
            work_order_updated_at=_dt(expected_updated_at),
            snapshot_json=serialized, snapshot_sha256=_hash(serialized),
            specialist_id=specialist_id, quantity=Decimal(form["quantity"]),
            unit=form["unit"], unit_price=Decimal(form["unit_price_rub"]),
            amount_cap=Decimal(form["amount_cap_rub"]), currency="RUB",
        )
        db.add(proposal)
        await db.flush()
        await outbox.enqueue(
            db, aggregate_type="client_scope_version", aggregate_id=proposal.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id":project.id, "user_id":actor.id,
                "kind":"client_scope_proposed",
                "title":"Предложение объёма работ на согласование",
                "body":f"Version {version}; sha256={proposal.snapshot_sha256}",
                "link_path":f"/work-order/{work.id}",
            },
        )
        await outbox.enqueue(
            db, aggregate_type="client_scope_version", aggregate_id=proposal.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id":project.customer_id,"project_id":project.id,
                "notification_type":"approval",
                "title":"Проверьте стоимость, объём, сроки и исполнителя",
                "body":f"Предложение № {version} — подтвердите только после проверки всех условий.",
                "link_path":f"/work-order/{work.id}","return_to":None,
            },
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(proposal)
    return _proposal_result(proposal)


async def decide_scope(
    db: AsyncSession,
    *, project: Project, scope_version_id: str, actor: User,
    digest: str, decision: str, reason: str | None = None,
) -> dict:
    if actor.id != project.customer_id:
        raise ValueError("scope_decision_customer_required")
    if decision not in ("approved", "rejected"):
        raise ValueError("scope_decision_invalid")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("scope_digest_invalid")
    if decision == "rejected":
        if not reason or not reason.strip() or len(reason.strip()) > 1000:
            raise ValueError("scope_rejection_reason_required")
    try:
        # Lock the shared project before the scope row; decisions against
        # different versions of the same project must be serialized.
        project_row = (await db.execute(
            select(Project).where(Project.id == project.id).with_for_update()
        )).scalar_one_or_none()
        if project_row is None or project_row.customer_id != actor.id:
            raise ValueError("scope_decision_customer_required")
        scope = (await db.execute(
            select(ClientScopeVersion).where(
                ClientScopeVersion.id == scope_version_id,
                ClientScopeVersion.project_id == project.id,
            ).with_for_update()
        )).scalar_one_or_none()
        if not scope:
            raise ValueError("scope_version_not_found")
        if _hash(scope.snapshot_json) != scope.snapshot_sha256:
            raise ValueError("scope_snapshot_integrity_failed")
        if digest != scope.snapshot_sha256:
            raise ValueError("scope_digest_mismatch")
        previous = (await db.execute(
            select(ClientScopeDecision).where(
                ClientScopeDecision.scope_version_id == scope.id
            )
        )).scalar_one_or_none()
        if previous:
            if previous.decision != decision:
                raise ValueError("scope_decision_final_conflict")
            authorization = await db.scalar(
                select(ClientFinancialAuthorization.id).where(
                    ClientFinancialAuthorization.decision_id == previous.id
                )
            )
            return {
                "scope_version_id":scope.id,"decision":previous.decision,
                "digest":scope.snapshot_sha256,"authorization_id":authorization,
                "replayed":True,
            }
        work = await _locked_work_order(
            db, project_id=project.id, work_order_id=scope.work_order_id,
        )
        if _status(work) not in _PENDING_STATES:
            raise ValueError("scope_work_order_not_pending")
        if work.updated_at is None or _dt(work.updated_at) != _dt(scope.work_order_updated_at):
            raise ValueError("scope_stale_work_order")
        newest = await db.scalar(
            select(ClientScopeVersion.id).where(
                ClientScopeVersion.work_order_id == work.id,
                ClientScopeVersion.project_id == project.id,
            ).order_by(ClientScopeVersion.version.desc()).limit(1)
        )
        if newest != scope.id:
            raise ValueError("scope_version_superseded")
        evidence = ClientScopeDecision(
            project_id=project.id, scope_version_id=scope.id,
            customer_id=actor.id, approved_digest=digest,
            decision=decision, reason=reason.strip() if reason else None,
        )
        db.add(evidence)
        await db.flush()
        authorization = None
        if decision == "approved":
            grant = ClientFinancialAuthorization(
                project_id=project.id, scope_version_id=scope.id,
                decision_id=evidence.id, customer_id=actor.id,
                amount_cap=scope.amount_cap, committed_amount=Decimal("0.00"),
                consumed_amount=Decimal("0.00"), currency="RUB",
            )
            db.add(grant)
            await db.flush()
            authorization = grant.id
        await outbox.enqueue(
            db, aggregate_type="client_scope_version", aggregate_id=scope.id,
            event_type=outbox.ACTIVITY_EVENT,
            payload={
                "project_id":project.id,"user_id":actor.id,
                "kind":"client_scope_decision",
                "title":"Заказчик согласовал условия" if decision == "approved" else "Заказчик отклонил условия",
                "body":f"{decision}; sha256={digest}",
                "link_path":f"/work-order/{scope.work_order_id}",
            },
        )
        if project.contractor_id:
            await outbox.enqueue(
                db, aggregate_type="client_scope_version", aggregate_id=scope.id,
                event_type=outbox.NOTIFICATION_EVENT,
                payload={
                    "user_id":project.contractor_id,"project_id":project.id,
                    "notification_type":"approval",
                    "title":"Решение заказчика по условиям работ",
                    "body":"Согласовано" if decision == "approved" else "Отклонено",
                    "link_path":f"/work-order/{scope.work_order_id}",
                    "return_to":None,
                },
            )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return {
        "scope_version_id":scope.id,"decision":decision,
        "digest":digest,"authorization_id":authorization,"replayed":False,
    }


async def list_scope_versions(
    db: AsyncSession, *, project_id: str, work_order_id: str | None = None,
) -> list[dict]:
    stmt = select(ClientScopeVersion).where(
        ClientScopeVersion.project_id == project_id
    ).order_by(ClientScopeVersion.created_at.desc(), ClientScopeVersion.version.desc()).limit(300)
    if work_order_id:
        stmt = stmt.where(ClientScopeVersion.work_order_id == work_order_id)
    rows = list((await db.execute(stmt)).scalars().all())
    if not rows:
        return []
    decisions = {
        row.scope_version_id: row
        for row in (await db.execute(select(ClientScopeDecision).where(
            ClientScopeDecision.scope_version_id.in_([r.id for r in rows]),
        ))).scalars().all()
    }
    grants = {
        row.scope_version_id: row
        for row in (await db.execute(select(ClientFinancialAuthorization).where(
            ClientFinancialAuthorization.scope_version_id.in_([r.id for r in rows]),
        ))).scalars().all()
    }
    output = []
    for row in rows:
        detail = _proposal_result(row)
        decision = decisions.get(row.id)
        grant = grants.get(row.id)
        detail.update({
            "decision":decision.decision if decision else "pending",
            "decided_at":decision.decided_at.isoformat() if decision else None,
            "authorization":({
                "id":grant.id, "cap_rub":str(grant.amount_cap),
                "committed_rub":str(grant.committed_amount),
                "consumed_rub":str(grant.consumed_amount),
                "currency":grant.currency,
                "linked_payments_qualified":False,
            } if grant else None),
        })
        output.append(detail)
    return output
