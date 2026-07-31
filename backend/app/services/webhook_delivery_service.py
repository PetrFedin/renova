"""Durable single-winner claims for provider webhook deliveries."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import PaymentWebhookEvent
from app.models.webhook_runtime import PaymentWebhookDelivery

MAX_ATTEMPTS = 12
LEASE_TTL = timedelta(minutes=2)
RETRY_BASE_SECONDS = 5
RETRY_MAX_SECONDS = 10 * 60


@dataclass(frozen=True)
class DeliveryClaim:
    status: str
    token: str | None = None
    attempts: int = 0


def _retry_delay(attempts: int) -> timedelta:
    seconds = min(
        RETRY_MAX_SECONDS,
        RETRY_BASE_SECONDS * 2 ** max(0, attempts - 1),
    )
    return timedelta(seconds=seconds)


def _claim_token(worker_id: str | None) -> str:
    prefix = (worker_id or "webhook")[:40]
    return f"{prefix}:{uuid.uuid4().hex[:32]}"


async def _ensure_delivery(
    db: AsyncSession,
    *,
    event_id: str,
    event_kind: str,
    provider: str,
) -> str:
    """Create the runtime row, preserving legacy completion markers."""
    if await db.get(PaymentWebhookEvent, event_id) is not None:
        await db.rollback()
        return "completed"

    existing = await db.get(PaymentWebhookDelivery, event_id)
    if existing is not None:
        await db.rollback()
        return "existing"

    now = utc_now()
    try:
        async with db.begin_nested():
            db.add(
                PaymentWebhookDelivery(
                    event_id=event_id,
                    provider=provider,
                    event_kind=event_kind,
                    attempts=0,
                    created_at=now,
                    updated_at=now,
                )
            )
            await db.flush()
        await db.commit()
        return "created"
    except IntegrityError:
        await db.rollback()
        if await db.get(PaymentWebhookEvent, event_id) is not None:
            await db.rollback()
            return "completed"
        await db.rollback()
        return "existing"


async def claim_delivery(
    db: AsyncSession,
    *,
    event_id: str,
    event_kind: str,
    provider: str = "yookassa",
    worker_id: str | None = None,
) -> DeliveryClaim:
    state = await _ensure_delivery(
        db,
        event_id=event_id,
        event_kind=event_kind,
        provider=provider,
    )
    if state == "completed":
        return DeliveryClaim(status="completed")

    now = utc_now()
    stale_before = now - LEASE_TTL
    token = _claim_token(worker_id)
    result = await db.execute(
        update(PaymentWebhookDelivery)
        .where(
            PaymentWebhookDelivery.event_id == event_id,
            PaymentWebhookDelivery.completed_at.is_(None),
            func.coalesce(PaymentWebhookDelivery.attempts, 0) < MAX_ATTEMPTS,
            or_(
                PaymentWebhookDelivery.next_attempt_at.is_(None),
                PaymentWebhookDelivery.next_attempt_at <= now,
            ),
            or_(
                PaymentWebhookDelivery.locked_at.is_(None),
                PaymentWebhookDelivery.locked_at < stale_before,
            ),
        )
        .values(
            locked_at=now,
            locked_by=token,
            updated_at=now,
        )
        .returning(PaymentWebhookDelivery.event_id)
    )
    acquired = result.first() is not None
    await db.commit()
    if acquired:
        row = await db.get(PaymentWebhookDelivery, event_id)
        attempts = int(row.attempts or 0) if row else 0
        await db.rollback()
        return DeliveryClaim(status="acquired", token=token, attempts=attempts)

    row = await db.get(PaymentWebhookDelivery, event_id)
    if row is None:
        await db.rollback()
        return DeliveryClaim(status="busy")
    if row.completed_at is not None:
        await db.rollback()
        return DeliveryClaim(status="completed", attempts=int(row.attempts or 0))
    if int(row.attempts or 0) >= MAX_ATTEMPTS:
        await db.rollback()
        return DeliveryClaim(status="poisoned", attempts=int(row.attempts or 0))
    await db.rollback()
    return DeliveryClaim(status="busy", attempts=int(row.attempts or 0))


async def complete_delivery(
    db: AsyncSession,
    *,
    event_id: str,
    claim_token: str,
    event_kind: str,
    outcome: str,
    provider: str = "yookassa",
) -> bool:
    """Commit business mutations and completion marker only for the current owner."""
    now = utc_now()
    result = await db.execute(
        update(PaymentWebhookDelivery)
        .where(
            PaymentWebhookDelivery.event_id == event_id,
            PaymentWebhookDelivery.completed_at.is_(None),
            PaymentWebhookDelivery.locked_by == claim_token,
        )
        .values(
            completed_at=now,
            outcome=outcome[:64],
            last_error=None,
            locked_at=None,
            locked_by=None,
            next_attempt_at=None,
            updated_at=now,
        )
        .returning(PaymentWebhookDelivery.event_id)
    )
    if result.first() is None:
        await db.rollback()
        return False

    db.add(
        PaymentWebhookEvent(
            event_id=event_id,
            provider=provider,
            payload_kind=event_kind,
        )
    )
    try:
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def fail_delivery(
    db: AsyncSession,
    *,
    event_id: str,
    claim_token: str,
    error: str,
) -> bool:
    """Release one owned claim with bounded retry state."""
    now = utc_now()
    result = await db.execute(
        update(PaymentWebhookDelivery)
        .where(
            PaymentWebhookDelivery.event_id == event_id,
            PaymentWebhookDelivery.completed_at.is_(None),
            PaymentWebhookDelivery.locked_by == claim_token,
        )
        .values(
            attempts=func.coalesce(PaymentWebhookDelivery.attempts, 0) + 1,
            last_error=error[:500],
            locked_at=None,
            locked_by=None,
            updated_at=now,
        )
        .returning(PaymentWebhookDelivery.attempts)
    )
    attempts = result.scalar_one_or_none()
    if attempts is None:
        await db.rollback()
        return False
    next_attempt_at = None
    if int(attempts) < MAX_ATTEMPTS:
        next_attempt_at = now + _retry_delay(int(attempts))
    await db.execute(
        update(PaymentWebhookDelivery)
        .where(
            PaymentWebhookDelivery.event_id == event_id,
            PaymentWebhookDelivery.locked_by.is_(None),
            PaymentWebhookDelivery.completed_at.is_(None),
            PaymentWebhookDelivery.attempts == attempts,
        )
        .values(next_attempt_at=next_attempt_at, updated_at=now)
    )
    await db.commit()
    return True


async def abandon_delivery(
    db: AsyncSession,
    *,
    event_id: str,
    claim_token: str,
) -> bool:
    """Release cancellation without consuming a processing attempt."""
    now = utc_now()
    result = await db.execute(
        update(PaymentWebhookDelivery)
        .where(
            PaymentWebhookDelivery.event_id == event_id,
            PaymentWebhookDelivery.completed_at.is_(None),
            PaymentWebhookDelivery.locked_by == claim_token,
        )
        .values(
            locked_at=None,
            locked_by=None,
            next_attempt_at=now,
            updated_at=now,
        )
        .returning(PaymentWebhookDelivery.event_id)
    )
    released = result.first() is not None
    if released:
        await db.commit()
    else:
        await db.rollback()
    return released
