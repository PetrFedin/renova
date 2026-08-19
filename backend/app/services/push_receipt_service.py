"""Durable Expo push-receipt reconciliation across API replicas."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Sequence

import httpx
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.db.session import SessionLocal
from app.models.entities import PushToken
from app.models.outbox_runtime import ExpoPushReceipt

EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
MAX_RECEIPTS_PER_REQUEST = 1000
INITIAL_RECEIPT_DELAY = timedelta(minutes=15)
RECEIPT_RETENTION = timedelta(hours=24)
RECEIPT_LEASE_TTL = timedelta(minutes=2)
MISSING_RECEIPT_RETRY = timedelta(minutes=1)
MAX_BACKOFF_SECONDS = 15 * 60

logger = logging.getLogger("renova.push.receipts")


@dataclass(frozen=True)
class AcceptedPushTicket:
    receipt_id: str
    push_token_id: str | None
    token: str
    delivery_id: str | None = None


@dataclass(frozen=True)
class ClaimedReceipt:
    row_id: str
    receipt_id: str
    claim_token: str
    push_token_id: str | None
    token_fingerprint: str
    attempts: int
    expires_at: datetime


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(f"renova:expo-token:{token}".encode("utf-8")).hexdigest()


def _batch_limit(limit: int) -> int:
    return max(1, min(int(limit), MAX_RECEIPTS_PER_REQUEST))


def _backoff(attempt: int) -> timedelta:
    seconds = min(MAX_BACKOFF_SECONDS, 30 * (2 ** min(max(attempt - 1, 0), 5)))
    return timedelta(seconds=seconds)


def _provider_message(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:1000] if text else None


def _receipt_error_code(receipt: dict) -> str | None:
    details = receipt.get("details")
    if isinstance(details, dict):
        error = details.get("error")
        if isinstance(error, str) and error:
            return error[:64]
    return None


async def record_accepted_tickets_persistently(
    tickets: Sequence[AcceptedPushTicket],
    *,
    now: datetime | None = None,
) -> int:
    """Persist successful Expo ticket IDs in an isolated transaction.

    A receipt ledger failure is intentionally propagated to the sender.  Marking
    an outbox notification delivered without durable provider follow-up would
    recreate the observability gap this ledger is designed to close.
    """
    if not tickets:
        return 0
    created = 0
    timestamp = now or utc_now()
    async with SessionLocal() as db:
        for ticket in tickets:
            receipt_id = str(ticket.receipt_id or "").strip()
            if not receipt_id:
                continue
            exists = await db.scalar(
                select(ExpoPushReceipt.id).where(
                    ExpoPushReceipt.expo_receipt_id == receipt_id
                )
            )
            if exists:
                continue
            token_id: str | None = None
            if ticket.push_token_id:
                current = await db.get(PushToken, ticket.push_token_id)
                if current is not None and current.token == ticket.token:
                    token_id = current.id
            row = ExpoPushReceipt(
                expo_receipt_id=receipt_id,
                push_token_id=token_id,
                token_fingerprint=token_fingerprint(ticket.token),
                delivery_id=ticket.delivery_id,
                status="pending",
                next_attempt_at=timestamp + INITIAL_RECEIPT_DELAY,
                expires_at=timestamp + RECEIPT_RETENTION,
                created_at=timestamp,
                updated_at=timestamp,
            )
            try:
                async with db.begin_nested():
                    db.add(row)
                    await db.flush()
                created += 1
            except IntegrityError:
                # Another replica may have persisted the same provider ticket.
                # The unique receipt ID is the durable idempotency boundary.
                continue
        await db.commit()
    return created


async def _expire_due(db: AsyncSession, *, now: datetime) -> int:
    result = await db.execute(
        update(ExpoPushReceipt)
        .where(
            ExpoPushReceipt.status == "pending",
            ExpoPushReceipt.completed_at.is_(None),
            ExpoPushReceipt.expires_at <= now,
        )
        .values(
            status="expired",
            provider_error="receipt_expired",
            provider_message="Expo receipt retention window elapsed before reconciliation",
            checked_at=now,
            completed_at=now,
            locked_at=None,
            locked_by=None,
            next_attempt_at=None,
            updated_at=now,
        )
    )
    await db.commit()
    return max(int(result.rowcount or 0), 0)


async def _claim_due(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int = MAX_RECEIPTS_PER_REQUEST,
    now: datetime | None = None,
) -> list[ClaimedReceipt]:
    timestamp = now or utc_now()
    stale_before = timestamp - RECEIPT_LEASE_TTL
    bounded = _batch_limit(limit)
    candidate_ids = list(
        (
            await db.execute(
                select(ExpoPushReceipt.id)
                .where(
                    ExpoPushReceipt.status == "pending",
                    ExpoPushReceipt.completed_at.is_(None),
                    ExpoPushReceipt.expires_at > timestamp,
                    ExpoPushReceipt.next_attempt_at.is_not(None),
                    ExpoPushReceipt.next_attempt_at <= timestamp,
                    or_(
                        ExpoPushReceipt.locked_at.is_(None),
                        ExpoPushReceipt.locked_at <= stale_before,
                    ),
                )
                .order_by(ExpoPushReceipt.next_attempt_at, ExpoPushReceipt.created_at)
                .limit(bounded)
            )
        ).scalars()
    )
    claims: list[ClaimedReceipt] = []
    for row_id in candidate_ids:
        claim_token = f"{worker_id}:{uuid.uuid4().hex}"
        result = await db.execute(
            update(ExpoPushReceipt)
            .where(
                ExpoPushReceipt.id == row_id,
                ExpoPushReceipt.status == "pending",
                ExpoPushReceipt.completed_at.is_(None),
                ExpoPushReceipt.expires_at > timestamp,
                ExpoPushReceipt.next_attempt_at.is_not(None),
                ExpoPushReceipt.next_attempt_at <= timestamp,
                or_(
                    ExpoPushReceipt.locked_at.is_(None),
                    ExpoPushReceipt.locked_at <= stale_before,
                ),
            )
            .values(locked_at=timestamp, locked_by=claim_token, updated_at=timestamp)
        )
        if int(result.rowcount or 0) != 1:
            await db.rollback()
            continue
        await db.commit()
        row = (
            await db.execute(
                select(ExpoPushReceipt).where(
                    ExpoPushReceipt.id == row_id,
                    ExpoPushReceipt.locked_by == claim_token,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            continue
        claims.append(
            ClaimedReceipt(
                row_id=row.id,
                receipt_id=row.expo_receipt_id,
                claim_token=claim_token,
                push_token_id=row.push_token_id,
                token_fingerprint=row.token_fingerprint,
                attempts=int(row.attempts or 0),
                expires_at=row.expires_at,
            )
        )
    return claims


async def _release_retry(
    db: AsyncSession,
    claim: ClaimedReceipt,
    *,
    now: datetime,
    error_code: str | None,
    message: str | None,
    consume_attempt: bool,
    delay: timedelta | None = None,
) -> bool:
    attempts = claim.attempts + (1 if consume_attempt else 0)
    retry_delay = delay if delay is not None else _backoff(max(attempts, 1))
    next_attempt = min(now + retry_delay, claim.expires_at)
    result = await db.execute(
        update(ExpoPushReceipt)
        .where(
            ExpoPushReceipt.id == claim.row_id,
            ExpoPushReceipt.status == "pending",
            ExpoPushReceipt.completed_at.is_(None),
            ExpoPushReceipt.locked_by == claim.claim_token,
        )
        .values(
            attempts=attempts,
            provider_error=error_code,
            provider_message=_provider_message(message),
            checked_at=now,
            next_attempt_at=next_attempt,
            locked_at=None,
            locked_by=None,
            updated_at=now,
        )
    )
    await db.commit()
    return int(result.rowcount or 0) == 1


async def _release_cancelled(
    db: AsyncSession,
    claim: ClaimedReceipt,
    *,
    now: datetime,
) -> bool:
    result = await db.execute(
        update(ExpoPushReceipt)
        .where(
            ExpoPushReceipt.id == claim.row_id,
            ExpoPushReceipt.status == "pending",
            ExpoPushReceipt.completed_at.is_(None),
            ExpoPushReceipt.locked_by == claim.claim_token,
        )
        .values(
            next_attempt_at=now,
            locked_at=None,
            locked_by=None,
            updated_at=now,
        )
    )
    await db.commit()
    return int(result.rowcount or 0) == 1


async def _finalize_ok(
    db: AsyncSession,
    claim: ClaimedReceipt,
    *,
    now: datetime,
) -> bool:
    result = await db.execute(
        update(ExpoPushReceipt)
        .where(
            ExpoPushReceipt.id == claim.row_id,
            ExpoPushReceipt.status == "pending",
            ExpoPushReceipt.completed_at.is_(None),
            ExpoPushReceipt.locked_by == claim.claim_token,
        )
        .values(
            status="reconciled",
            provider_error=None,
            provider_message=None,
            checked_at=now,
            completed_at=now,
            next_attempt_at=None,
            locked_at=None,
            locked_by=None,
            updated_at=now,
        )
    )
    await db.commit()
    return int(result.rowcount or 0) == 1


async def _finalize_error(
    db: AsyncSession,
    claim: ClaimedReceipt,
    *,
    now: datetime,
    error_code: str | None,
    message: str | None,
) -> bool:
    result = await db.execute(
        update(ExpoPushReceipt)
        .where(
            ExpoPushReceipt.id == claim.row_id,
            ExpoPushReceipt.status == "pending",
            ExpoPushReceipt.completed_at.is_(None),
            ExpoPushReceipt.locked_by == claim.claim_token,
        )
        .values(
            status="error",
            provider_error=error_code or "provider_error",
            provider_message=_provider_message(message),
            checked_at=now,
            completed_at=now,
            next_attempt_at=None,
            locked_at=None,
            locked_by=None,
            updated_at=now,
        )
    )
    if int(result.rowcount or 0) != 1:
        await db.rollback()
        return False

    if error_code == "DeviceNotRegistered" and claim.push_token_id:
        token = await db.get(PushToken, claim.push_token_id)
        if token is not None and token_fingerprint(token.token) == claim.token_fingerprint:
            await db.delete(token)
    await db.commit()
    return True


async def reconcile_pending(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int = MAX_RECEIPTS_PER_REQUEST,
) -> dict[str, int]:
    """Reconcile one bounded provider batch while preserving fenced ownership."""
    now = utc_now()
    expired = await _expire_due(db, now=now)
    claims = await _claim_due(db, worker_id=worker_id, limit=limit, now=now)
    metrics = {
        "claimed": len(claims),
        "reconciled": 0,
        "errors": 0,
        "missing": 0,
        "retried": 0,
        "expired": expired,
    }
    if not claims:
        return metrics

    receipt_ids = [claim.receipt_id for claim in claims]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                EXPO_RECEIPTS_URL,
                json={"ids": receipt_ids},
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except asyncio.CancelledError:
        released_at = utc_now()
        for claim in claims:
            await _release_cancelled(db, claim, now=released_at)
        raise
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        failed_at = utc_now()
        for claim in claims:
            if await _release_retry(
                db,
                claim,
                now=failed_at,
                error_code="receipt_transport_error",
                message=str(exc),
                consume_attempt=True,
            ):
                metrics["retried"] += 1
        logger.warning(
            "Expo receipt request failed",
            extra={"claimed": len(claims), "worker_id": worker_id},
            exc_info=exc,
        )
        return metrics

    data = payload.get("data") if isinstance(payload, dict) else None
    request_errors = payload.get("errors") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or request_errors:
        failed_at = utc_now()
        for claim in claims:
            if await _release_retry(
                db,
                claim,
                now=failed_at,
                error_code="receipt_request_error",
                message=_provider_message(request_errors or "malformed receipt response"),
                consume_attempt=True,
            ):
                metrics["retried"] += 1
        logger.warning(
            "Expo receipt request-level error",
            extra={"claimed": len(claims), "worker_id": worker_id},
        )
        return metrics

    checked_at = utc_now()
    for claim in claims:
        receipt = data.get(claim.receipt_id)
        if receipt is None:
            if await _release_retry(
                db,
                claim,
                now=checked_at,
                error_code=None,
                message=None,
                consume_attempt=False,
                delay=MISSING_RECEIPT_RETRY,
            ):
                metrics["missing"] += 1
            continue
        if not isinstance(receipt, dict):
            if await _release_retry(
                db,
                claim,
                now=checked_at,
                error_code="malformed_receipt",
                message="receipt payload is not an object",
                consume_attempt=True,
            ):
                metrics["retried"] += 1
            continue

        status = receipt.get("status")
        if status == "ok":
            if await _finalize_ok(db, claim, now=checked_at):
                metrics["reconciled"] += 1
            continue
        if status == "error":
            error_code = _receipt_error_code(receipt)
            if await _finalize_error(
                db,
                claim,
                now=checked_at,
                error_code=error_code,
                message=_provider_message(receipt.get("message")),
            ):
                metrics["errors"] += 1
                logger.warning(
                    "Expo push receipt terminal error",
                    extra={
                        "receipt_id": claim.receipt_id,
                        "delivery_id": None,
                        "error_code": error_code,
                    },
                )
            continue

        if await _release_retry(
            db,
            claim,
            now=checked_at,
            error_code="unknown_receipt_status",
            message=_provider_message(status),
            consume_attempt=True,
        ):
            metrics["retried"] += 1

    return metrics


async def runtime_snapshot(db: AsyncSession) -> dict[str, object]:
    now = utc_now()
    stale_before = now - RECEIPT_LEASE_TTL

    async def count_status(status: str) -> int:
        return int(
            await db.scalar(
                select(func.count()).select_from(ExpoPushReceipt).where(
                    ExpoPushReceipt.status == status
                )
            )
            or 0
        )

    pending = await count_status("pending")
    reconciled = await count_status("reconciled")
    errors = await count_status("error")
    expired = await count_status("expired")
    due = int(
        await db.scalar(
            select(func.count()).select_from(ExpoPushReceipt).where(
                ExpoPushReceipt.status == "pending",
                ExpoPushReceipt.next_attempt_at.is_not(None),
                ExpoPushReceipt.next_attempt_at <= now,
                ExpoPushReceipt.expires_at > now,
            )
        )
        or 0
    )
    active_leases = int(
        await db.scalar(
            select(func.count()).select_from(ExpoPushReceipt).where(
                ExpoPushReceipt.status == "pending",
                ExpoPushReceipt.locked_at.is_not(None),
                ExpoPushReceipt.locked_at > stale_before,
            )
        )
        or 0
    )
    stale_leases = int(
        await db.scalar(
            select(func.count()).select_from(ExpoPushReceipt).where(
                ExpoPushReceipt.status == "pending",
                ExpoPushReceipt.locked_at.is_not(None),
                ExpoPushReceipt.locked_at <= stale_before,
            )
        )
        or 0
    )
    oldest_created = await db.scalar(
        select(func.min(ExpoPushReceipt.created_at)).where(
            ExpoPushReceipt.status == "pending"
        )
    )
    latest_checked = await db.scalar(select(func.max(ExpoPushReceipt.checked_at)))
    return {
        "pending": pending,
        "due": due,
        "reconciled": reconciled,
        "terminal_errors": errors,
        "expired": expired,
        "active_leases": active_leases,
        "stale_leases": stale_leases,
        "oldest_pending_age_seconds": max(0, int((now - oldest_created).total_seconds()))
        if oldest_created
        else None,
        "last_checked_at": latest_checked.isoformat() if latest_checked else None,
        "max_batch_size": MAX_RECEIPTS_PER_REQUEST,
    }
