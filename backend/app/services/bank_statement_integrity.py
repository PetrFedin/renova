"""Canonical bank-statement identity, signed match claims and atomic settlement."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timeutil import utc_now
from app.models.entities import (
    Expense,
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    _uuid,
)

_BANK_MARKER_PREFIX = "bank_statement:v1:"
_MATCH_TOKEN_TTL_SECONDS = 30 * 60
_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class MatchClaim:
    payment_id: str
    row_id: str
    amount: float


@dataclass(frozen=True)
class BankConfirmResult:
    confirmed: list[str]
    replayed: list[str]
    blocked: list[str]


def _normalized_description(value: str | None) -> str:
    return _SPACE_RE.sub(" ", (value or "").strip().lower())[:300]


def _amount_cents(value: Any) -> int:
    return int(round(abs(float(value or 0)) * 100))


def _row_base(row: dict[str, Any]) -> str:
    return "|".join(
        (
            str(row.get("date") or ""),
            str(_amount_cents(row.get("amount"))),
            _normalized_description(row.get("description")),
        )
    )


def annotate_statement_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach a stable identity, preserving legitimate identical rows by ordinal."""
    ordinals: dict[str, int] = defaultdict(int)
    annotated: list[dict[str, Any]] = []
    for source in rows:
        row = dict(source)
        base = _row_base(row)
        ordinal = ordinals[base]
        ordinals[base] += 1
        row_id = hashlib.sha256(f"{base}|{ordinal}".encode("utf-8")).hexdigest()
        row["bank_row_id"] = row_id
        row["bank_row_ordinal"] = ordinal
        annotated.append(row)
    return annotated


def expense_marker(row_id: str) -> str:
    return f"{_BANK_MARKER_PREFIX}{row_id}"


def _sign(body: str) -> str:
    return hmac.new(settings.secret_key.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()


def create_match_token(
    *,
    project_id: str,
    user_id: str,
    matches: list[dict[str, Any]],
    ttl_seconds: int = _MATCH_TOKEN_TTL_SECONDS,
) -> str | None:
    claims: list[dict[str, Any]] = []
    for match in matches:
        row = match.get("row") or {}
        payment_id = str(match.get("payment_id") or "")
        row_id = str(row.get("bank_row_id") or "")
        if not payment_id or not row_id:
            continue
        claims.append(
            {
                "payment_id": payment_id,
                "row_id": row_id,
                "amount_cents": _amount_cents(match.get("payment_amount")),
            }
        )
    if not claims:
        return None
    claims.sort(key=lambda item: (item["payment_id"], item["row_id"]))
    now = int(time.time())
    payload = {
        "v": 1,
        "project_id": project_id,
        "sub": user_id,
        "iat": now,
        "exp": now + max(60, int(ttl_seconds)),
        "matches": claims,
    }
    body = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"{body}.{_sign(body)}"


def verify_match_token(
    token: str,
    *,
    project_id: str,
    user_id: str,
    payment_ids: list[str],
) -> list[MatchClaim]:
    if not token or "." not in token:
        raise ValueError("bank_match_token_invalid")
    body, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(body), signature):
        raise ValueError("bank_match_token_invalid")
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("bank_match_token_invalid") from exc
    if int(payload.get("exp") or 0) < int(time.time()):
        raise ValueError("bank_match_token_expired")
    if payload.get("project_id") != project_id or payload.get("sub") != user_id:
        raise ValueError("bank_match_token_scope_mismatch")

    requested = list(dict.fromkeys(str(value) for value in payment_ids if value))
    if not requested:
        raise ValueError("bank_payment_ids_required")
    token_claims: dict[str, MatchClaim] = {}
    for item in payload.get("matches") or []:
        payment_id = str(item.get("payment_id") or "")
        row_id = str(item.get("row_id") or "")
        if not payment_id or not row_id or payment_id in token_claims:
            raise ValueError("bank_match_token_invalid")
        token_claims[payment_id] = MatchClaim(
            payment_id=payment_id,
            row_id=row_id,
            amount=round(float(item.get("amount_cents") or 0) / 100, 2),
        )
    if any(payment_id not in token_claims for payment_id in requested):
        raise ValueError("bank_match_not_authorized")
    return [token_claims[payment_id] for payment_id in requested]


async def _lock_project(db: AsyncSession, project_id: str) -> None:
    query = select(Project.id).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    if (await db.execute(query.limit(1))).scalar_one_or_none() is None:
        raise ValueError("bank_project_not_found")


async def create_expenses_from_rows(
    db: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
    rows: list[dict[str, Any]],
    limit: int = 50,
) -> dict[str, Any]:
    """Create each unmatched statement row once, including retries and overlaps."""
    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    selected = [row for row in rows[:limit] if row.get("bank_row_id")]
    if not selected:
        return {"expenses_created": 0, "expenses_replayed": 0, "expense_ids": []}
    await _lock_project(db, project_id)
    markers = [expense_marker(str(row["bank_row_id"])) for row in selected]
    existing_rows = (
        await db.execute(
            select(Expense).where(
                Expense.project_id == project_id,
                Expense.comment.in_(markers),
            )
        )
    ).scalars().all()
    existing_by_marker = {str(expense.comment): expense for expense in existing_rows}

    created_ids: list[str] = []
    replayed = 0
    for row, marker in zip(selected, markers):
        if marker in existing_by_marker:
            replayed += 1
            continue
        amount = round(abs(float(row.get("amount") or 0)), 2)
        if amount <= 0:
            continue
        expense_date = None
        if row.get("date"):
            try:
                expense_date = datetime.strptime(str(row["date"]), "%Y-%m-%d")
            except ValueError:
                expense_date = None
        title = (_normalized_description(row.get("description")) or f"Банк {amount:.0f} ₽")[:255]
        expense = await budget.expense_from_bank_row(
            db,
            project_id=project_id,
            amount=amount,
            title=title,
            expense_date=expense_date,
            comment=marker,
        )
        created_ids.append(expense.id)
        existing_by_marker[marker] = expense

    if created_ids:
        await budget.refresh_budget_facts(db, project_id)
        batch_id = hashlib.sha256("|".join(sorted(markers)).encode("utf-8")).hexdigest()[:36]
        await outbox.enqueue(
            db,
            aggregate_type="bank_import",
            aggregate_id=batch_id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project_id,
                "user_id": actor_id,
                "kind": "BankImportExpenses",
                "title": f"Расходы из выписки: {len(created_ids)}",
                "body": f"Повторно распознано: {replayed}",
                "link_path": "/(customer)/(tabs)/budget?tab=expenses",
            },
        )
    await db.commit()
    return {
        "expenses_created": len(created_ids),
        "expenses_replayed": replayed,
        "expense_ids": created_ids[:20],
    }


async def confirm_matches(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    claims: list[MatchClaim],
) -> BankConfirmResult:
    """Confirm authorized matches in one transaction with evidence and durable effects."""
    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    confirmed: list[str] = []
    replayed: list[str] = []
    blocked: list[str] = []
    mutated: list[Payment] = []

    for claim in claims:
        query = select(Payment).where(
            Payment.id == claim.payment_id,
            Payment.project_id == project.id,
        )
        try:
            query = query.with_for_update()
        except Exception:
            pass
        payment = (await db.execute(query.limit(1))).scalar_one_or_none()
        if not payment or round(float(payment.amount or 0), 2) != claim.amount:
            blocked.append(claim.payment_id)
            continue
        if payment.status == PaymentStatus.confirmed:
            replayed.append(payment.id)
            continue
        if payment.status in {PaymentStatus.cancelled, PaymentStatus.disputed, PaymentStatus.refunded}:
            blocked.append(payment.id)
            continue
        if payment.status not in {PaymentStatus.pending, PaymentStatus.processing, PaymentStatus.paid_unverified}:
            blocked.append(payment.id)
            continue
        if payment.payment_type == PaymentType.stage and payment.stage_id:
            stage = (
                await db.execute(
                    select(Stage).where(
                        Stage.id == payment.stage_id,
                        Stage.project_id == project.id,
                    ).limit(1)
                )
            ).scalar_one_or_none()
            if not stage or not stage.customer_accepted_at:
                blocked.append(payment.id)
                continue

        old_status = payment.status.value
        payment.status = PaymentStatus.confirmed
        payment.payment_method = "bank_transfer"
        payment.confirmed_at = payment.confirmed_at or utc_now()
        db.add(
            PaymentEvent(
                id=_uuid(),
                payment_id=payment.id,
                source="bank_import",
                old_status=old_status,
                new_status=PaymentStatus.confirmed.value,
                evidence_type="bank_statement",
                evidence_ref=claim.row_id,
                note="bank_statement_match",
            )
        )
        await db.flush()
        await budget.expense_from_payment(db, payment)
        mutated.append(payment)
        confirmed.append(payment.id)

        activity = await outbox.enqueue(
            db,
            aggregate_type="payment",
            aggregate_id=payment.id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project.id,
                "user_id": actor_id,
                "kind": "PaymentApproved",
                "title": f"Оплата по выписке: {payment.title}",
                "body": str(payment.amount),
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
            },
        )
        del activity
        for member_id in {project.customer_id, project.contractor_id}:
            if not member_id or member_id == actor_id:
                continue
            customer_link = member_id == project.customer_id
            await outbox.enqueue(
                db,
                aggregate_type="payment",
                aggregate_id=payment.id,
                event_type=outbox.PAYMENT_CREATED_EVENT,
                payload={
                    "user_id": member_id,
                    "project_id": project.id,
                    "notification_type": "payment_confirmed",
                    "title": f"Оплата подтверждена по выписке: {payment.title}",
                    "body": str(payment.amount),
                    "link_path": "/(customer)/(tabs)/budget?tab=payments" if customer_link else "/(contractor)/(tabs)/budget?tab=payments",
                    "return_to": "/(customer)/(tabs)/home" if customer_link else "/(contractor)/(tabs)/home",
                },
            )

    if mutated:
        await budget.refresh_budget_facts(db, project.id)
    await db.commit()
    return BankConfirmResult(confirmed=confirmed, replayed=replayed, blocked=blocked)
