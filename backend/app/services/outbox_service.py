"""Transactional outbox enqueue + leased, retryable dispatch."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox, _uuid
from app.models.outbox_runtime import DomainOutboxLease

logger = logging.getLogger("renova.outbox")

PAYMENT_CREATED_EVENT = "financial.payment_created"
RECEIPT_CREATED_EVENT = "financial.receipt_created"
MAX_ATTEMPTS = 8
LEASE_TTL = timedelta(minutes=2)
RETRY_BASE_SECONDS = 5
RETRY_MAX_SECONDS = 5 * 60


async def enqueue(
    db: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: str,
    event_type: str,
    payload: dict,
) -> DomainOutbox:
    row = DomainOutbox(
        id=_uuid(),
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload_json=json.dumps(payload, ensure_ascii=False),
        created_at=utc_now(),
    )
    db.add(row)
    db.add(DomainOutboxLease(outbox_id=row.id))
    await db.flush()
    return row


def _retry_delay(attempts: int) -> timedelta:
    seconds = min(
        RETRY_MAX_SECONDS,
        RETRY_BASE_SECONDS * 2 ** max(0, attempts - 1),
    )
    return timedelta(seconds=seconds)


async def _candidate_ids(
    db: AsyncSession,
    *,
    now: datetime,
    limit: int,
) -> list[str]:
    stale_before = now - LEASE_TTL
    query = (
        select(DomainOutbox.id)
        .outerjoin(DomainOutboxLease, DomainOutboxLease.outbox_id == DomainOutbox.id)
        .where(
            DomainOutbox.processed_at.is_(None),
            DomainOutbox.attempts < MAX_ATTEMPTS,
            or_(
                DomainOutboxLease.outbox_id.is_(None),
                and_(
                    or_(
                        DomainOutboxLease.next_attempt_at.is_(None),
                        DomainOutboxLease.next_attempt_at <= now,
                    ),
                    or_(
                        DomainOutboxLease.locked_at.is_(None),
                        DomainOutboxLease.locked_at < stale_before,
                    ),
                ),
            ),
        )
        .order_by(DomainOutbox.created_at.asc())
        .limit(limit)
    )
    return list((await db.execute(query)).scalars().all())


async def _ensure_lease(db: AsyncSession, outbox_id: str) -> None:
    if await db.get(DomainOutboxLease, outbox_id):
        return
    try:
        async with db.begin_nested():
            db.add(DomainOutboxLease(outbox_id=outbox_id))
            await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()


async def _claim(
    db: AsyncSession,
    *,
    outbox_id: str,
    worker_id: str,
    now: datetime,
) -> bool:
    await _ensure_lease(db, outbox_id)
    stale_before = now - LEASE_TTL
    result = await db.execute(
        update(DomainOutboxLease)
        .where(
            DomainOutboxLease.outbox_id == outbox_id,
            or_(
                DomainOutboxLease.next_attempt_at.is_(None),
                DomainOutboxLease.next_attempt_at <= now,
            ),
            or_(
                DomainOutboxLease.locked_at.is_(None),
                DomainOutboxLease.locked_at < stale_before,
            ),
        )
        .values(locked_at=now, locked_by=worker_id, updated_at=now)
    )
    await db.commit()
    return bool(result.rowcount == 1)


async def _release_success(
    db: AsyncSession,
    *,
    outbox_id: str,
    now: datetime,
) -> None:
    row = await db.get(DomainOutbox, outbox_id)
    lease = await db.get(DomainOutboxLease, outbox_id)
    if row:
        row.processed_at = now
        row.attempts = (row.attempts or 0) + 1
        row.last_error = None
    if lease:
        lease.locked_at = None
        lease.locked_by = None
        lease.next_attempt_at = None
        lease.updated_at = now
    await db.commit()


async def _release_failure(
    db: AsyncSession,
    *,
    outbox_id: str,
    error: Exception,
    now: datetime,
) -> None:
    row = await db.get(DomainOutbox, outbox_id)
    lease = await db.get(DomainOutboxLease, outbox_id)
    attempts = 1
    if row:
        row.attempts = (row.attempts or 0) + 1
        row.last_error = str(error)[:500]
        attempts = row.attempts
    if lease:
        lease.locked_at = None
        lease.locked_by = None
        lease.next_attempt_at = None if attempts >= MAX_ATTEMPTS else now + _retry_delay(attempts)
        lease.updated_at = now
    await db.commit()


async def dispatch_pending(
    db: AsyncSession,
    *,
    limit: int = 20,
    worker_id: str | None = None,
) -> int:
    """Claim and process eligible rows without duplicate multi-instance delivery."""
    worker = worker_id or f"worker-{uuid.uuid4().hex[:12]}"
    done = 0
    for outbox_id in await _candidate_ids(db, now=utc_now(), limit=limit):
        claimed_at = utc_now()
        if not await _claim(
            db,
            outbox_id=outbox_id,
            worker_id=worker,
            now=claimed_at,
        ):
            continue
        row = await db.get(DomainOutbox, outbox_id)
        if not row or row.processed_at is not None:
            await _release_success(db, outbox_id=outbox_id, now=utc_now())
            continue
        try:
            await _handle(db, row)
            await _release_success(db, outbox_id=outbox_id, now=utc_now())
            done += 1
        except Exception as exc:  # noqa: BLE001 — isolate each durable event
            await db.rollback()
            await _release_failure(db, outbox_id=outbox_id, error=exc, now=utc_now())
            logger.exception("outbox failed id=%s type=%s", row.id, row.event_type)
    return done


async def _handle(db: AsyncSession, row: DomainOutbox) -> None:
    payload = json.loads(row.payload_json or "{}")
    if row.event_type == "acceptance.side_effects":
        from app.models.entities import Payment, Project, Stage
        from app.services.accept_orchestrator import emit_acceptance_side_effects

        project = await db.get(Project, payload["project_id"])
        stage = await db.get(Stage, payload["stage_id"])
        if not project or not stage:
            raise RuntimeError("acceptance_outbox_target_missing")
        payment = await db.get(Payment, payload["payment_id"]) if payload.get("payment_id") else None
        next_stage = await db.get(Stage, payload["next_stage_id"]) if payload.get("next_stage_id") else None
        await emit_acceptance_side_effects(
            db,
            project=project,
            stage=stage,
            accepted_by=payload.get("accepted_by") or "",
            comment=payload.get("comment"),
            payment=payment,
            next_stage=next_stage,
            source=payload.get("source") or "app",
        )
        return

    if row.event_type == PAYMENT_CREATED_EVENT:
        from app.services import notification_service as notifications

        await notifications.notify_from_outbox(
            db,
            outbox_id=row.id,
            user_id=payload["user_id"],
            project_id=payload.get("project_id"),
            notification_type=payload.get("notification_type") or "payment_pending",
            title=payload["title"],
            body=payload["body"],
            link_path=payload.get("link_path"),
            return_to=payload.get("return_to"),
        )
        return

    if row.event_type == RECEIPT_CREATED_EVENT:
        from app.services import activity_service as activity

        await activity.log_event_from_outbox(
            db,
            outbox_id=row.id,
            project_id=payload["project_id"],
            user_id=payload.get("user_id"),
            kind=payload.get("kind") or "ExpenseAdded",
            title=payload["title"],
            body=payload.get("body"),
            room_id=payload.get("room_id"),
            work_type=payload.get("work_type"),
            link_path=payload.get("link_path"),
        )
        return

    raise ValueError(f"unknown_outbox_event_type:{row.event_type}")
