"""Durable provider-read reconciliation primitives.

This module intentionally does not send provider side effects. DomainOutbox owns
outbound delivery. ProviderReconciliation owns only repeated reads of external
authoritative state and their bounded operational lifecycle.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.provider_runtime import ProviderReconciliation

ACTIVE_STATUSES = ("pending", "retry")
TERMINAL_STATUSES = ("completed", "terminal", "unavailable")
DEFAULT_LEASE_SECONDS = 60
MAX_ATTEMPTS = 12
MAX_BACKOFF_SECONDS = 6 * 60 * 60


@dataclass(frozen=True)
class ReconciliationClaim:
    id: str
    provider: str
    operation_type: str
    resource_type: str
    resource_id: str
    provider_resource_id: str | None
    generation: int
    attempts: int


def _fingerprint(error: BaseException | str | None) -> str | None:
    if error is None:
        return None
    # Hash only. Provider messages may contain request IDs, URLs or other data
    # we do not want persisted in operational state.
    value = f"{type(error).__name__}:{error}" if isinstance(error, BaseException) else str(error)
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def _bounded_code(code: str | None) -> str | None:
    if not code:
        return None
    value = "".join(ch for ch in str(code).strip() if ch.isalnum() or ch in "._:-")
    return value[:64] or None


def retry_delay_seconds(attempts: int) -> int:
    attempt = max(1, int(attempts))
    return min(MAX_BACKOFF_SECONDS, 15 * (2 ** min(attempt - 1, 10)))


async def ensure_reconciliation(
    db: AsyncSession,
    *,
    provider: str,
    operation_type: str,
    resource_type: str,
    resource_id: str,
    provider_resource_id: str | None = None,
    next_attempt_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> ProviderReconciliation:
    """Return the deterministic ledger row for one provider-readable resource.

    Callers should create it in the same transaction that makes reconciliation
    necessary. No provider network call happens here.
    """
    stmt = select(ProviderReconciliation).where(
        ProviderReconciliation.provider == provider,
        ProviderReconciliation.operation_type == operation_type,
        ProviderReconciliation.resource_type == resource_type,
        ProviderReconciliation.resource_id == resource_id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        if provider_resource_id and not existing.provider_resource_id:
            existing.provider_resource_id = provider_resource_id
        if expires_at and not existing.expires_at:
            existing.expires_at = expires_at
        return existing

    row = ProviderReconciliation(
        provider=provider,
        operation_type=operation_type,
        resource_type=resource_type,
        resource_id=resource_id,
        provider_resource_id=provider_resource_id,
        status="pending",
        attempts=0,
        claim_generation=0,
        next_attempt_at=next_attempt_at or utc_now(),
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return row


async def claim_due(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int = 25,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    now: datetime | None = None,
) -> list[ReconciliationClaim]:
    """Claim due rows with a fencing generation safe across API/worker replicas."""
    current = now or utc_now()
    stale_before = current - timedelta(seconds=max(1, lease_seconds))
    due = and_(
        ProviderReconciliation.status.in_(ACTIVE_STATUSES),
        or_(
            ProviderReconciliation.next_attempt_at.is_(None),
            ProviderReconciliation.next_attempt_at <= current,
        ),
        or_(
            ProviderReconciliation.expires_at.is_(None),
            ProviderReconciliation.expires_at > current,
        ),
        or_(
            ProviderReconciliation.locked_at.is_(None),
            ProviderReconciliation.locked_at <= stale_before,
        ),
    )
    candidates = (
        await db.execute(
            select(
                ProviderReconciliation.id,
                ProviderReconciliation.claim_generation,
            )
            .where(due)
            .order_by(
                ProviderReconciliation.next_attempt_at.asc(),
                ProviderReconciliation.created_at.asc(),
            )
            .limit(max(1, min(int(limit), 100)))
        )
    ).all()

    claims: list[ReconciliationClaim] = []
    for row_id, generation in candidates:
        result = await db.execute(
            update(ProviderReconciliation)
            .where(
                ProviderReconciliation.id == row_id,
                ProviderReconciliation.claim_generation == generation,
                due,
            )
            .values(
                locked_at=current,
                locked_by=worker_id[:96],
                claim_generation=generation + 1,
                attempts=ProviderReconciliation.attempts + 1,
                last_attempt_at=current,
                updated_at=current,
            )
        )
        if result.rowcount != 1:
            continue
        claimed = await db.get(ProviderReconciliation, row_id)
        if claimed is None:
            continue
        claims.append(
            ReconciliationClaim(
                id=claimed.id,
                provider=claimed.provider,
                operation_type=claimed.operation_type,
                resource_type=claimed.resource_type,
                resource_id=claimed.resource_id,
                provider_resource_id=claimed.provider_resource_id,
                generation=claimed.claim_generation,
                attempts=claimed.attempts,
            )
        )
    await db.flush()
    return claims


async def _finish_claim(
    db: AsyncSession,
    claim: ReconciliationClaim,
    *,
    worker_id: str,
    values: dict,
) -> bool:
    current = utc_now()
    result = await db.execute(
        update(ProviderReconciliation)
        .where(
            ProviderReconciliation.id == claim.id,
            ProviderReconciliation.claim_generation == claim.generation,
            ProviderReconciliation.locked_by == worker_id[:96],
            ProviderReconciliation.status.in_(ACTIVE_STATUSES),
        )
        .values(
            **values,
            locked_at=None,
            locked_by=None,
            updated_at=current,
        )
    )
    await db.flush()
    return result.rowcount == 1


async def mark_completed(
    db: AsyncSession,
    claim: ReconciliationClaim,
    *,
    worker_id: str,
    provider_status: str | None = None,
) -> bool:
    now = utc_now()
    return await _finish_claim(
        db,
        claim,
        worker_id=worker_id,
        values={
            "status": "completed",
            "provider_status": _bounded_code(provider_status),
            "next_attempt_at": None,
            "completed_at": now,
            "last_error_code": None,
            "last_error_fingerprint": None,
        },
    )


async def mark_retry(
    db: AsyncSession,
    claim: ReconciliationClaim,
    *,
    worker_id: str,
    error_code: str,
    error: BaseException | str | None = None,
    provider_status: str | None = None,
    now: datetime | None = None,
) -> bool:
    current = now or utc_now()
    if claim.attempts >= MAX_ATTEMPTS:
        return await mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="retry_exhausted",
            error=error,
            provider_status=provider_status,
        )
    return await _finish_claim(
        db,
        claim,
        worker_id=worker_id,
        values={
            "status": "retry",
            "provider_status": _bounded_code(provider_status),
            "next_attempt_at": current + timedelta(seconds=retry_delay_seconds(claim.attempts)),
            "completed_at": None,
            "last_error_code": _bounded_code(error_code),
            "last_error_fingerprint": _fingerprint(error),
        },
    )


async def mark_terminal(
    db: AsyncSession,
    claim: ReconciliationClaim,
    *,
    worker_id: str,
    error_code: str,
    error: BaseException | str | None = None,
    provider_status: str | None = None,
    unavailable: bool = False,
) -> bool:
    return await _finish_claim(
        db,
        claim,
        worker_id=worker_id,
        values={
            "status": "unavailable" if unavailable else "terminal",
            "provider_status": _bounded_code(provider_status),
            "next_attempt_at": None,
            "completed_at": utc_now(),
            "last_error_code": _bounded_code(error_code),
            "last_error_fingerprint": _fingerprint(error),
        },
    )


async def runtime_snapshot(db: AsyncSession) -> dict[str, object]:
    """Safe aggregate provider reconciliation state for operator health views."""
    rows = (
        await db.execute(
            select(
                ProviderReconciliation.provider,
                ProviderReconciliation.status,
                func.count(ProviderReconciliation.id),
            ).group_by(ProviderReconciliation.provider, ProviderReconciliation.status)
        )
    ).all()
    providers: dict[str, dict[str, int]] = {}
    for provider, status, count in rows:
        providers.setdefault(provider, {})[status] = int(count)
    return {
        "providers": providers,
        "pending_total": sum(
            counts.get("pending", 0) + counts.get("retry", 0)
            for counts in providers.values()
        ),
        "terminal_total": sum(
            counts.get("terminal", 0) + counts.get("unavailable", 0)
            for counts in providers.values()
        ),
    }
