"""Safe operator inspection and recovery for provider reconciliation failures.

The service exposes bounded operational metadata only. It never returns provider
payloads, credentials, raw exception text, or provider resource identifiers.
Request-level AuditMiddleware records every mutating admin API call.
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.provider_runtime import ProviderReconciliation

RECOVERABLE_STATUSES = ("terminal", "unavailable")
_VISIBLE_STATUSES = ("pending", "retry", "completed", "terminal", "unavailable")


class ProviderReconciliationNotFound(Exception):
    code = "provider_reconciliation_not_found"


class ProviderReconciliationConflict(Exception):
    def __init__(self, code: str, **context: object):
        super().__init__(code)
        self.code = code
        self.context = context


def _canonical_id(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ProviderReconciliationNotFound() from exc


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


def _serialize(row: ProviderReconciliation) -> dict[str, object]:
    return {
        "id": row.id,
        "provider": row.provider,
        "operation_type": row.operation_type,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "status": row.status,
        "provider_status": row.provider_status,
        "attempts": int(row.attempts or 0),
        "claim_generation": int(row.claim_generation or 0),
        "error_code": row.last_error_code,
        "error_fingerprint": row.last_error_fingerprint,
        "next_attempt_at": _iso(row.next_attempt_at),
        "last_attempt_at": _iso(row.last_attempt_at),
        "completed_at": _iso(row.completed_at),
        "expires_at": _iso(row.expires_at),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "recoverable": row.status in RECOVERABLE_STATUSES,
    }


async def list_reconciliations(
    db: AsyncSession,
    *,
    status: str | None = None,
    provider: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    filters = []
    if status is None:
        filters.append(ProviderReconciliation.status.in_(RECOVERABLE_STATUSES))
    else:
        normalized_status = str(status).strip().lower()
        if normalized_status not in _VISIBLE_STATUSES:
            raise ProviderReconciliationConflict("provider_reconciliation_status_invalid")
        filters.append(ProviderReconciliation.status == normalized_status)
    if provider:
        normalized_provider = str(provider).strip().lower()
        if not normalized_provider or len(normalized_provider) > 32:
            raise ProviderReconciliationConflict("provider_reconciliation_provider_invalid")
        filters.append(ProviderReconciliation.provider == normalized_provider)

    total = int(
        await db.scalar(
            select(func.count()).select_from(ProviderReconciliation).where(*filters)
        )
        or 0
    )
    rows = (
        await db.execute(
            select(ProviderReconciliation)
            .where(*filters)
            .order_by(
                ProviderReconciliation.updated_at.asc(),
                ProviderReconciliation.id.asc(),
            )
            .offset(max(0, int(offset)))
            .limit(max(1, min(int(limit), 100)))
        )
    ).scalars().all()
    return {
        "total": total,
        "limit": max(1, min(int(limit), 100)),
        "offset": max(0, int(offset)),
        "items": [_serialize(row) for row in rows],
    }


async def get_reconciliation(
    db: AsyncSession,
    *,
    reconciliation_id: str,
) -> dict[str, object]:
    row = await db.get(ProviderReconciliation, _canonical_id(reconciliation_id))
    if row is None:
        raise ProviderReconciliationNotFound()
    return _serialize(row)


async def requeue_reconciliation(
    db: AsyncSession,
    *,
    reconciliation_id: str,
) -> dict[str, object]:
    """Atomically recover a terminal provider-read operation.

    claim_generation is incremented to fence any stale worker. attempts and
    diagnostics are reset for the new operator-authorized lifecycle. An expired
    explicit deadline is cleared because replay is an intentional new lifecycle;
    the request audit log records who authorized that transition.
    """
    row_id = _canonical_id(reconciliation_id)
    current = await db.get(ProviderReconciliation, row_id)
    if current is None:
        raise ProviderReconciliationNotFound()
    if current.status not in RECOVERABLE_STATUSES:
        raise ProviderReconciliationConflict(
            "provider_reconciliation_not_recoverable",
            status=current.status,
        )

    now = utc_now()
    result = await db.execute(
        update(ProviderReconciliation)
        .where(
            ProviderReconciliation.id == row_id,
            ProviderReconciliation.status == current.status,
            ProviderReconciliation.claim_generation == current.claim_generation,
        )
        .values(
            status="retry",
            attempts=0,
            claim_generation=ProviderReconciliation.claim_generation + 1,
            next_attempt_at=now,
            locked_at=None,
            locked_by=None,
            completed_at=None,
            expires_at=None,
            last_error_code=None,
            last_error_fingerprint=None,
            updated_at=now,
        )
        .returning(ProviderReconciliation.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.first() is None:
        await db.rollback()
        raise ProviderReconciliationConflict("provider_reconciliation_requeue_race")
    await db.commit()
    refreshed = await db.get(ProviderReconciliation, row_id)
    if refreshed is None:
        raise ProviderReconciliationNotFound()
    await db.refresh(refreshed)
    return _serialize(refreshed)
