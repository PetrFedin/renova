"""Prepare and bind transactional side effects to the current request task."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Payment, Project, Receipt
from app.services import outbox_service as outbox


@dataclass(frozen=True)
class PreparedSideEffect:
    effect_type: str
    outbox_id: str
    match_key: str | None = None


_active_side_effects: ContextVar[tuple[PreparedSideEffect, ...]] = ContextVar(
    "active_client_write_side_effects",
    default=(),
)
_suppress_payment_transition_effects: ContextVar[bool] = ContextVar(
    "suppress_payment_transition_effects",
    default=False,
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
        return PreparedSideEffect(
            effect_type="notification",
            outbox_id=row.id,
            match_key=project.customer_id,
        )

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
    activate_client_write_side_effects([effect] if effect is not None else [])


def activate_client_write_side_effects(effects: Iterable[PreparedSideEffect]) -> None:
    prepared = tuple(effect for effect in effects if effect is not None)
    if prepared:
        _active_side_effects.set(prepared)


def take_client_write_side_effect(
    effect_type: str,
    *,
    match_key: str | None = None,
) -> str | None:
    effects = list(_active_side_effects.get())
    for index, effect in enumerate(effects):
        if effect.effect_type != effect_type:
            continue
        if effect.match_key is not None and effect.match_key != match_key:
            continue
        effects.pop(index)
        _active_side_effects.set(tuple(effects))
        return effect.outbox_id
    return None


def suppress_payment_transition_side_effects() -> None:
    _suppress_payment_transition_effects.set(True)


def payment_transition_side_effects_suppressed() -> bool:
    return _suppress_payment_transition_effects.get()


def clear_request_side_effect_context() -> None:
    _active_side_effects.set(())
    _suppress_payment_transition_effects.set(False)
