"""Administrator recovery workflow for poisoned domain-outbox events.

The service deliberately never returns event payloads or raw exception text.
Existing outbox leases provide cross-process fencing; the request audit log
provides an immutable operator history without adding a second audit system.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import AuditLog, DomainOutbox
from app.models.outbox_runtime import DomainOutboxLease
from app.services import outbox_service

DEAD_LETTER_CLAIM_TTL = timedelta(minutes=15)
_SAFE_ERROR_CODE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


class DeadLetterNotFound(Exception):
    code = "dead_letter_not_found"


class DeadLetterConflict(Exception):
    def __init__(self, code: str, **context: object):
        super().__init__(code)
        self.code = code
        self.context = context


def _canonical_outbox_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise DeadLetterNotFound() from exc


def _operator_prefix(user_id: str) -> str:
    return f"dlq:{user_id}:"


def _token_belongs_to(token: str, user_id: str) -> bool:
    return token.startswith(_operator_prefix(user_id))


def _claim_ttl(locked_by: str | None) -> timedelta:
    if locked_by and locked_by.startswith("dlq:"):
        return DEAD_LETTER_CLAIM_TTL
    return outbox_service.LEASE_TTL


def _claim_expires_at(lease: DomainOutboxLease | None) -> datetime | None:
    if lease is None or lease.locked_at is None or not lease.locked_by:
        return None
    return lease.locked_at + _claim_ttl(lease.locked_by)


def _claim_is_active(lease: DomainOutboxLease | None, now: datetime) -> bool:
    expires_at = _claim_expires_at(lease)
    return expires_at is not None and expires_at > now


def _safe_error(last_error: str | None) -> tuple[str | None, str | None]:
    raw = (last_error or "").strip()
    if not raw:
        return None, None
    first_line = raw.splitlines()[0].strip()
    code = first_line if _SAFE_ERROR_CODE.fullmatch(first_line) else "internal_delivery_error"
    fingerprint = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return code, fingerprint


def _serialize(
    row: DomainOutbox,
    lease: DomainOutboxLease | None,
    *,
    admin_user_id: str,
    now: datetime,
) -> dict[str, object]:
    error_code, error_fingerprint = _safe_error(row.last_error)
    expires_at = _claim_expires_at(lease)
    active = _claim_is_active(lease, now)
    owner = None
    if active and lease and lease.locked_by:
        owner = "self" if _token_belongs_to(lease.locked_by, admin_user_id) else "other"
    claim_state = "unclaimed"
    if active:
        claim_state = "claimed_self" if owner == "self" else "claimed"
    elif lease and lease.locked_at is not None:
        claim_state = "expired"
    payload_size = len((row.payload_json or "").encode("utf-8"))
    return {
        "id": row.id,
        "aggregate_type": row.aggregate_type,
        "aggregate_id": row.aggregate_id,
        "event_type": row.event_type,
        "created_at": row.created_at.isoformat() + "Z",
        "attempts": int(row.attempts or 0),
        "max_attempts": outbox_service.MAX_ATTEMPTS,
        "error_code": error_code,
        "error_fingerprint": error_fingerprint,
        "payload_size_bytes": payload_size,
        "claim_state": claim_state,
        "claim_owner": owner,
        "claim_expires_at": expires_at.isoformat() + "Z" if active and expires_at else None,
        "replayable": bool(
            row.processed_at is None
            and int(row.attempts or 0) >= outbox_service.MAX_ATTEMPTS
            and claim_state in {"unclaimed", "expired", "claimed_self"}
        ),
    }


async def _poisoned_row(db: AsyncSession, outbox_id: str) -> DomainOutbox:
    canonical = _canonical_outbox_id(outbox_id)
    row = await db.get(DomainOutbox, canonical)
    if row is None:
        raise DeadLetterNotFound()
    if row.processed_at is not None:
        raise DeadLetterConflict("dead_letter_already_processed")
    if int(row.attempts or 0) < outbox_service.MAX_ATTEMPTS:
        raise DeadLetterConflict(
            "dead_letter_not_poisoned",
            attempts=int(row.attempts or 0),
            max_attempts=outbox_service.MAX_ATTEMPTS,
        )
    return row


async def _ensure_lease(db: AsyncSession, outbox_id: str) -> DomainOutboxLease:
    lease = await db.get(DomainOutboxLease, outbox_id)
    if lease is not None:
        return lease
    try:
        async with db.begin_nested():
            db.add(DomainOutboxLease(outbox_id=outbox_id))
            await db.flush()
    except IntegrityError:
        pass
    lease = await db.get(DomainOutboxLease, outbox_id)
    if lease is None:
        raise RuntimeError("dead_letter_lease_unavailable")
    return lease


async def runtime_health(db: AsyncSession) -> dict[str, object]:
    """Augment the bounded outbox snapshot with an explicit release-health signal."""
    snapshot = await outbox_service.runtime_snapshot(db)
    poisoned = int(snapshot.get("poisoned") or 0)
    stale = int(snapshot.get("stale_leases") or 0)
    status = "healthy"
    if poisoned > 0:
        status = "critical"
    elif stale > 0:
        status = "degraded"
    snapshot.update(
        {
            "healthy": status == "healthy",
            "status": status,
            "poisoned_threshold": 0,
            "dead_letter_recovery_ready": True,
        }
    )
    return snapshot


async def list_dead_letters(
    db: AsyncSession,
    *,
    admin_user_id: str,
    limit: int = 50,
    offset: int = 0,
    event_type: str | None = None,
) -> dict[str, object]:
    filters = [
        DomainOutbox.processed_at.is_(None),
        func.coalesce(DomainOutbox.attempts, 0) >= outbox_service.MAX_ATTEMPTS,
    ]
    if event_type:
        filters.append(DomainOutbox.event_type == event_type)
    total = int(
        await db.scalar(select(func.count()).select_from(DomainOutbox).where(*filters))
        or 0
    )
    query = (
        select(DomainOutbox, DomainOutboxLease)
        .outerjoin(DomainOutboxLease, DomainOutboxLease.outbox_id == DomainOutbox.id)
        .where(*filters)
        .order_by(DomainOutbox.created_at.asc(), DomainOutbox.id.asc())
        .offset(max(0, offset))
        .limit(max(1, min(limit, 100)))
    )
    now = utc_now()
    items = [
        _serialize(row, lease, admin_user_id=admin_user_id, now=now)
        for row, lease in (await db.execute(query)).all()
    ]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


async def get_dead_letter(
    db: AsyncSession,
    *,
    outbox_id: str,
    admin_user_id: str,
) -> dict[str, object]:
    row = await _poisoned_row(db, outbox_id)
    lease = await db.get(DomainOutboxLease, row.id)
    return _serialize(row, lease, admin_user_id=admin_user_id, now=utc_now())


async def claim_dead_letter(
    db: AsyncSession,
    *,
    outbox_id: str,
    admin_user_id: str,
) -> dict[str, object]:
    row = await _poisoned_row(db, outbox_id)
    lease = await _ensure_lease(db, row.id)
    now = utc_now()
    if _claim_is_active(lease, now):
        if lease.locked_by and _token_belongs_to(lease.locked_by, admin_user_id):
            return {
                "claim_token": lease.locked_by,
                "claim_expires_at": _claim_expires_at(lease).isoformat() + "Z",
                "replayed": True,
            }
        raise DeadLetterConflict(
            "dead_letter_claimed",
            claim_expires_at=_claim_expires_at(lease).isoformat() + "Z",
        )

    token = f"{_operator_prefix(admin_user_id)}{secrets.token_hex(6)}"
    conditions = [DomainOutboxLease.outbox_id == row.id]
    if lease.locked_by is None:
        conditions.append(DomainOutboxLease.locked_by.is_(None))
    else:
        conditions.append(DomainOutboxLease.locked_by == lease.locked_by)
    if lease.locked_at is None:
        conditions.append(DomainOutboxLease.locked_at.is_(None))
    else:
        conditions.append(DomainOutboxLease.locked_at == lease.locked_at)
    claimed = (
        await db.execute(
            update(DomainOutboxLease)
            .where(*conditions)
            .values(locked_by=token, locked_at=now, next_attempt_at=None, updated_at=now)
            .returning(DomainOutboxLease.outbox_id)
        )
    ).first()
    if claimed is None:
        await db.rollback()
        raise DeadLetterConflict("dead_letter_claim_race")
    await db.commit()
    return {
        "claim_token": token,
        "claim_expires_at": (now + DEAD_LETTER_CLAIM_TTL).isoformat() + "Z",
        "replayed": False,
    }


async def _require_owned_claim(
    db: AsyncSession,
    *,
    row: DomainOutbox,
    admin_user_id: str,
    claim_token: str,
) -> DomainOutboxLease:
    lease = await db.get(DomainOutboxLease, row.id)
    now = utc_now()
    if (
        lease is None
        or not _claim_is_active(lease, now)
        or not lease.locked_by
        or not secrets.compare_digest(lease.locked_by, claim_token)
        or not _token_belongs_to(claim_token, admin_user_id)
    ):
        raise DeadLetterConflict("dead_letter_claim_invalid_or_expired")
    return lease


async def release_dead_letter(
    db: AsyncSession,
    *,
    outbox_id: str,
    admin_user_id: str,
    claim_token: str,
) -> dict[str, object]:
    row = await _poisoned_row(db, outbox_id)
    await _require_owned_claim(
        db,
        row=row,
        admin_user_id=admin_user_id,
        claim_token=claim_token,
    )
    now = utc_now()
    released = (
        await db.execute(
            update(DomainOutboxLease)
            .where(
                DomainOutboxLease.outbox_id == row.id,
                DomainOutboxLease.locked_by == claim_token,
            )
            .values(
                locked_by=None,
                locked_at=None,
                next_attempt_at=None,
                updated_at=now,
            )
            .returning(DomainOutboxLease.outbox_id)
        )
    ).first()
    if released is None:
        await db.rollback()
        raise DeadLetterConflict("dead_letter_claim_lost")
    await db.commit()
    return {"released": True, "id": row.id}


async def _dispatch_specific(
    db: AsyncSession,
    *,
    outbox_id: str,
    admin_user_id: str,
) -> dict[str, object]:
    row = await db.get(DomainOutbox, outbox_id)
    if row is None:
        return {"status": "missing"}
    if row.processed_at is not None:
        return {"status": "processed"}
    if int(row.attempts or 0) >= outbox_service.MAX_ATTEMPTS:
        return {"status": "poisoned", "attempts": int(row.attempts or 0)}

    token = await outbox_service._claim(
        db,
        outbox_id=outbox_id,
        worker_id=f"admin-replay-{admin_user_id[:8]}",
        now=utc_now(),
    )
    if token is None:
        return {"status": "queued"}
    row = await db.get(DomainOutbox, outbox_id)
    if row is None or row.processed_at is not None:
        await outbox_service._release_abandoned(
            db,
            outbox_id=outbox_id,
            claim_token=token,
            now=utc_now(),
        )
        return {"status": "processed"}
    try:
        await outbox_service._handle(db, row, operator_replay=True)
        delivered = await outbox_service._release_success(
            db,
            outbox_id=outbox_id,
            claim_token=token,
            now=utc_now(),
        )
        return {"status": "delivered" if delivered else "fenced"}
    except asyncio.CancelledError:
        await db.rollback()
        await outbox_service._release_abandoned(
            db,
            outbox_id=outbox_id,
            claim_token=token,
            now=utc_now(),
        )
        raise
    except Exception as exc:  # noqa: BLE001 - delivery errors remain durable
        await db.rollback()
        await outbox_service._release_failure(
            db,
            outbox_id=outbox_id,
            claim_token=token,
            error=exc,
            now=utc_now(),
        )
        refreshed = await db.get(DomainOutbox, outbox_id)
        attempts = int(refreshed.attempts or 0) if refreshed else 0
        return {
            "status": "poisoned"
            if attempts >= outbox_service.MAX_ATTEMPTS
            else "retry_scheduled",
            "attempts": attempts,
        }


async def replay_dead_letter(
    db: AsyncSession,
    *,
    outbox_id: str,
    admin_user_id: str,
    claim_token: str,
    dispatch_now: bool = True,
) -> dict[str, object]:
    row = await _poisoned_row(db, outbox_id)
    await _require_owned_claim(
        db,
        row=row,
        admin_user_id=admin_user_id,
        claim_token=claim_token,
    )
    now = utc_now()
    reset = (
        await db.execute(
            update(DomainOutbox)
            .where(
                DomainOutbox.id == row.id,
                DomainOutbox.processed_at.is_(None),
                func.coalesce(DomainOutbox.attempts, 0) >= outbox_service.MAX_ATTEMPTS,
            )
            .values(attempts=0)
            .returning(DomainOutbox.id)
        )
    ).first()
    if reset is None:
        await db.rollback()
        raise DeadLetterConflict("dead_letter_replay_race")
    released = (
        await db.execute(
            update(DomainOutboxLease)
            .where(
                DomainOutboxLease.outbox_id == row.id,
                DomainOutboxLease.locked_by == claim_token,
            )
            .values(
                locked_by=None,
                locked_at=None,
                next_attempt_at=now,
                updated_at=now,
            )
            .returning(DomainOutboxLease.outbox_id)
        )
    ).first()
    if released is None:
        await db.rollback()
        raise DeadLetterConflict("dead_letter_claim_lost")
    await db.commit()

    dispatch = {"status": "queued"}
    if dispatch_now:
        dispatch = await _dispatch_specific(
            db,
            outbox_id=row.id,
            admin_user_id=admin_user_id,
        )
    return {"id": row.id, "requeued": True, "dispatch": dispatch}


async def dead_letter_history(
    db: AsyncSession,
    *,
    outbox_id: str,
    limit: int = 50,
) -> list[dict[str, object]]:
    canonical = _canonical_outbox_id(outbox_id)
    row = await db.get(DomainOutbox, canonical)
    if row is None:
        raise DeadLetterNotFound()
    prefix = f"/api/v1/admin/outbox/dead-letters/{canonical}/"
    logs = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.path.like(prefix + "%"))
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(max(1, min(limit, 100)))
        )
    ).scalars().all()
    return [
        {
            "actor_user_id": log.user_id,
            "action": log.path.rsplit("/", 1)[-1],
            "status_code": log.status_code,
            "created_at": log.created_at.isoformat() + "Z",
        }
        for log in logs
    ]
