"""Safe, bulk projection of payment evidence for customer-facing history."""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import PaymentEvent, Receipt, User, UserRole

_SAFE_NOTE_EVIDENCE = {
    "customer_dispute",
    "customer_dispute_resolution",
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


def payment_event_dict(event: PaymentEvent, role_by_user: dict[str, str]) -> dict:
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

    grouped: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        grouped[event.payment_id].append(payment_event_dict(event, role_by_user))
    return dict(grouped)
