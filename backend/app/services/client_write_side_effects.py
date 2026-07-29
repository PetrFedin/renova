"""Prepare transactional side effects for idempotent client create requests."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, Project, Receipt
from app.services import outbox_service as outbox


@dataclass(frozen=True)
class PreparedSideEffect:
    effect_type: str
    outbox_id: str


_active_side_effect: ContextVar[PreparedSideEffect | None] = ContextVar(
    "active_client_write_side_effect",
    default=None,
)


async def prepare_client_write_side_effect(
    db: AsyncSession,
    *,
    scope: str,
    project_id: str,
    user_id: str,
    entity_id: str,
) -> PreparedSideEffect | None:
    if scope == "payment.create":
        payment = await db.get(Payment, entity_id)
        project = await db.get(Project, project_id)
        if not payment or not project or not project.customer_id or project.customer_id == user_id:
            return None
        row = await outbox.enqueue(
            db,
            aggregate_type="payment",
            aggregate_id=payment.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project_id,
                "notification_type": "payment_pending",
                "title": f"Счёт к оплате: {payment.title}",
                "body": str(payment.amount),
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
                "return_to": "/(customer)/(tabs)/home",
            },
        )
        return PreparedSideEffect(effect_type="notification", outbox_id=row.id)

    if scope in {"receipt.scan", "receipt.manual"}:
        receipt = await db.get(Receipt, entity_id)
        if not receipt:
            return None
        expense = (
            await db.execute(
                select(Expense)
                .where(Expense.receipt_id == receipt.id)
                .order_by(Expense.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        title = expense.title if expense else (receipt.qr_raw or f"Чек {receipt.amount:.0f} ₽")
        amount = expense.amount if expense else receipt.amount
        row = await outbox.enqueue(
            db,
            aggregate_type="receipt",
            aggregate_id=receipt.id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project_id,
                "user_id": user_id,
                "kind": "ExpenseAdded",
                "title": title,
                "body": str(amount),
                "room_id": receipt.room_id,
                "link_path": "/(customer)/(tabs)/budget",
            },
        )
        return PreparedSideEffect(effect_type="activity", outbox_id=row.id)

    return None


def activate_client_write_side_effect(effect: PreparedSideEffect | None) -> None:
    if effect is not None:
        _active_side_effect.set(effect)


def take_client_write_side_effect(effect_type: str) -> str | None:
    effect = _active_side_effect.get()
    if not effect or effect.effect_type != effect_type:
        return None
    _active_side_effect.set(None)
    return effect.outbox_id
