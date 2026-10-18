"""Safe, bulk projection of payment evidence for customer-facing history."""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import PaymentEvent, Receipt, User, UserRole
from app.models.project_payment_refund import ProjectPaymentRefund

_SAFE_NOTE_EVIDENCE = {
    "customer_dispute",
    "customer_dispute_resolution",
    "contractor_dispute_comment",
    "contractor_dispute_agree",
    "contractor_dispute_contest",
    "invoice_cancelled",
    "invoice_rejected",
    "recipient_confirmed",
    "recipient_denied",
}


def _actor_label(event: PaymentEvent, role_by_user: dict[str, str]) -> str:
    if event.actor_user_id:
        role = role_by_user.get(event.actor_user_id)
        if role == UserRole.customer.value:
            return "Заказчик"
        if role == UserRole.contractor.value:
            return "Исполнитель"
    if event.source == "webhook":
        return "ЮKassa"
    if event.source == "bank_statement":
        return "Банковская выписка"
    if event.source == "manual":
        return "Пользователь"
    return "Система"


def payment_event_dict(
    event: PaymentEvent, role_by_user: dict[str, str],
    refund_amounts: dict[tuple[str, str], float] | None = None,
) -> dict:
    evidence_type = str(event.evidence_type or "") or None
    return {
        "id": event.id,
        "old_status": event.old_status,
        "new_status": event.new_status,
        "source": event.source,
        "evidence_type": evidence_type,
        "note": event.note if evidence_type in _SAFE_NOTE_EVIDENCE else None,
        "actor_label": _actor_label(event, role_by_user),
        "created_at": event.created_at.isoformat(),
        "refund_amount": (
            (refund_amounts or {}).get((event.payment_id, event.evidence_ref or ""))
            if evidence_type in {"yookassa_refund_partial", "yookassa_refund"} else None
        ),
    }


async def receipt_ids_by_payment(
    db: AsyncSession,
    payment_ids: list[str],
) -> dict[str, str]:
    if not payment_ids:
        return {}
    rows = (
        await db.execute(
            select(Receipt.payment_id, Receipt.id)
            .where(Receipt.payment_id.in_(payment_ids))
            .order_by(Receipt.created_at.desc(), Receipt.id.desc())
        )
    ).all()
    result: dict[str, str] = {}
    for payment_id, receipt_id in rows:
        if payment_id and payment_id not in result:
            result[payment_id] = receipt_id
    return result


async def events_by_payment(
    db: AsyncSession,
    payment_ids: list[str],
) -> dict[str, list[dict]]:
    if not payment_ids:
        return {}
    events = list(
        (
            await db.execute(
                select(PaymentEvent)
                .where(PaymentEvent.payment_id.in_(payment_ids))
                .order_by(PaymentEvent.created_at.asc(), PaymentEvent.id.asc())
            )
        ).scalars().all()
    )
    actor_ids = {event.actor_user_id for event in events if event.actor_user_id}
    role_by_user: dict[str, str] = {}
    if actor_ids:
        users = (
            await db.execute(
                select(User.id, User.role).where(User.id.in_(actor_ids))
            )
        ).all()
        role_by_user = {
            user_id: role.value if hasattr(role, "value") else str(role)
            for user_id, role in users
        }

    refund_ids = {
        event.evidence_ref for event in events
        if event.evidence_type in {"yookassa_refund_partial", "yookassa_refund"}
        and event.evidence_ref
    }
    refund_amounts: dict[tuple[str, str], float] = {}
    if refund_ids:
        rows = (
            await db.execute(
                select(
                    ProjectPaymentRefund.payment_id,
                    ProjectPaymentRefund.provider_refund_id,
                    ProjectPaymentRefund.amount,
                )
                # A foreign PaymentEvent evidence_ref must never leak another
                # project's money, even if the database contains a stale event.
                .where(
                    ProjectPaymentRefund.payment_id.in_(payment_ids),
                    ProjectPaymentRefund.provider_refund_id.in_(refund_ids),
                )
            )
        ).all()
        refund_amounts = {
            (payment_id, refund_id): float(amount)
            for payment_id, refund_id, amount in rows
        }

    grouped: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        grouped[event.payment_id].append(payment_event_dict(event, role_by_user, refund_amounts))
    return dict(grouped)
