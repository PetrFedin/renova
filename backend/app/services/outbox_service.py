"""Transactional outbox enqueue + fenced, retryable dispatch."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox, _uuid
from app.models.outbox_runtime import DomainOutboxLease

logger = logging.getLogger("renova.outbox")

PAYMENT_CREATED_EVENT = "financial.payment_created"
RECEIPT_CREATED_EVENT = "financial.receipt_created"
NOTIFICATION_EVENT = "notification.created"
ACTIVITY_EVENT = "activity.created"
ACCEPTANCE_SIDE_EFFECTS_EVENT = "acceptance.side_effects"
MAX_ATTEMPTS = 8
LEASE_TTL = timedelta(minutes=2)
RETRY_BASE_SECONDS = 5
RETRY_MAX_SECONDS = 5 * 60
_EFFECT_NAMESPACE = uuid.UUID("29a31cf5-f2dd-49f1-8ad7-f44f268d15da")


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


async def enqueue_once(
    db: AsyncSession,
    *,
    parent_outbox_id: str,
    effect_key: str,
    aggregate_type: str,
    aggregate_id: str,
    event_type: str,
    payload: dict,
) -> DomainOutbox:
    """Create a deterministic child event once across parent retries."""
    row_id = str(uuid.uuid5(_EFFECT_NAMESPACE, f"{parent_outbox_id}:{effect_key}"))
    existing = await db.get(DomainOutbox, row_id)
    if existing is not None:
        return existing

    row = DomainOutbox(
        id=row_id,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload_json=json.dumps(payload, ensure_ascii=False),
        created_at=utc_now(),
    )
    try:
        async with db.begin_nested():
            db.add(row)
            db.add(DomainOutboxLease(outbox_id=row.id))
            await db.flush()
    except IntegrityError:
        existing = await db.get(DomainOutbox, row_id)
        if existing is None:
            raise
        return existing
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
            func.coalesce(DomainOutbox.attempts, 0) < MAX_ATTEMPTS,
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
        .order_by(DomainOutbox.created_at.asc(), DomainOutbox.id.asc())
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


def _claim_token(worker_id: str) -> str:
    prefix = (worker_id or "worker")[:32]
    return f"{prefix}:{uuid.uuid4().hex[:24]}"


async def _claim(
    db: AsyncSession,
    *,
    outbox_id: str,
    worker_id: str,
    now: datetime,
) -> str | None:
    await _ensure_lease(db, outbox_id)
    stale_before = now - LEASE_TTL
    token = _claim_token(worker_id)
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
        .values(locked_at=now, locked_by=token, updated_at=now)
        .returning(DomainOutboxLease.outbox_id)
    )
    claimed = result.first() is not None
    await db.commit()
    return token if claimed else None


async def _touch_owned_claim(
    db: AsyncSession,
    *,
    outbox_id: str,
    claim_token: str,
    now: datetime,
) -> bool:
    result = await db.execute(
        update(DomainOutboxLease)
        .where(
            DomainOutboxLease.outbox_id == outbox_id,
            DomainOutboxLease.locked_by == claim_token,
        )
        .values(updated_at=now)
        .returning(DomainOutboxLease.outbox_id)
    )
    return result.first() is not None


async def _release_success(
    db: AsyncSession,
    *,
    outbox_id: str,
    claim_token: str,
    now: datetime,
) -> bool:
    if not await _touch_owned_claim(
        db,
        outbox_id=outbox_id,
        claim_token=claim_token,
        now=now,
    ):
        await db.rollback()
        return False

    result = await db.execute(
        update(DomainOutbox)
        .where(
            DomainOutbox.id == outbox_id,
            DomainOutbox.processed_at.is_(None),
        )
        .values(
            processed_at=now,
            attempts=func.coalesce(DomainOutbox.attempts, 0) + 1,
            last_error=None,
        )
        .returning(DomainOutbox.id)
    )
    await db.execute(
        update(DomainOutboxLease)
        .where(
            DomainOutboxLease.outbox_id == outbox_id,
            DomainOutboxLease.locked_by == claim_token,
        )
        .values(
            locked_at=None,
            locked_by=None,
            next_attempt_at=None,
            updated_at=now,
        )
    )
    await db.commit()
    return result.first() is not None


async def _release_failure(
    db: AsyncSession,
    *,
    outbox_id: str,
    claim_token: str,
    error: Exception,
    now: datetime,
) -> bool:
    if not await _touch_owned_claim(
        db,
        outbox_id=outbox_id,
        claim_token=claim_token,
        now=now,
    ):
        await db.rollback()
        return False

    result = await db.execute(
        update(DomainOutbox)
        .where(
            DomainOutbox.id == outbox_id,
            DomainOutbox.processed_at.is_(None),
        )
        .values(
            attempts=func.coalesce(DomainOutbox.attempts, 0) + 1,
            last_error=str(error)[:500],
        )
        .returning(DomainOutbox.attempts)
    )
    attempts = result.scalar_one_or_none()
    next_attempt_at = None
    if attempts is not None and attempts < MAX_ATTEMPTS:
        next_attempt_at = now + _retry_delay(int(attempts))
    await db.execute(
        update(DomainOutboxLease)
        .where(
            DomainOutboxLease.outbox_id == outbox_id,
            DomainOutboxLease.locked_by == claim_token,
        )
        .values(
            locked_at=None,
            locked_by=None,
            next_attempt_at=next_attempt_at,
            updated_at=now,
        )
    )
    await db.commit()
    return attempts is not None


async def _release_abandoned(
    db: AsyncSession,
    *,
    outbox_id: str,
    claim_token: str,
    now: datetime,
) -> bool:
    """Release a cancelled/no-op claim without consuming an attempt."""
    result = await db.execute(
        update(DomainOutboxLease)
        .where(
            DomainOutboxLease.outbox_id == outbox_id,
            DomainOutboxLease.locked_by == claim_token,
        )
        .values(
            locked_at=None,
            locked_by=None,
            next_attempt_at=now,
            updated_at=now,
        )
        .returning(DomainOutboxLease.outbox_id)
    )
    released = result.first() is not None
    if released:
        await db.commit()
    else:
        await db.rollback()
    return released


async def dispatch_pending(
    db: AsyncSession,
    *,
    limit: int = 20,
    worker_id: str | None = None,
) -> int:
    """Claim and process eligible rows with owner-fenced completion."""
    worker = worker_id or f"worker-{uuid.uuid4().hex[:12]}"
    done = 0
    claimed_count = 0

    while claimed_count < max(0, limit):
        candidates = await _candidate_ids(
            db,
            now=utc_now(),
            limit=max(1, limit - claimed_count),
        )
        if not candidates:
            break
        claimed_in_round = False

        for outbox_id in candidates:
            if claimed_count >= limit:
                break
            claimed_at = utc_now()
            token = await _claim(
                db,
                outbox_id=outbox_id,
                worker_id=worker,
                now=claimed_at,
            )
            if token is None:
                continue
            claimed_in_round = True
            claimed_count += 1

            row = await db.get(DomainOutbox, outbox_id)
            if not row or row.processed_at is not None:
                await _release_abandoned(
                    db,
                    outbox_id=outbox_id,
                    claim_token=token,
                    now=utc_now(),
                )
                continue
            try:
                await _handle(db, row)
                if await _release_success(
                    db,
                    outbox_id=outbox_id,
                    claim_token=token,
                    now=utc_now(),
                ):
                    done += 1
            except asyncio.CancelledError:
                await db.rollback()
                await _release_abandoned(
                    db,
                    outbox_id=outbox_id,
                    claim_token=token,
                    now=utc_now(),
                )
                raise
            except Exception as exc:  # noqa: BLE001 — isolate each durable event
                await db.rollback()
                await _release_failure(
                    db,
                    outbox_id=outbox_id,
                    claim_token=token,
                    error=exc,
                    now=utc_now(),
                )
                logger.exception("outbox failed id=%s type=%s", row.id, row.event_type)

        if not claimed_in_round:
            break
    return done


async def runtime_snapshot(db: AsyncSession) -> dict[str, object]:
    """Return bounded operational metrics without exposing event payloads."""
    now = utc_now()
    stale_before = now - LEASE_TTL
    pending = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.processed_at.is_(None)
            )
        )
        or 0
    )
    retryable = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.processed_at.is_(None),
                func.coalesce(DomainOutbox.attempts, 0) < MAX_ATTEMPTS,
            )
        )
        or 0
    )
    poisoned = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.processed_at.is_(None),
                func.coalesce(DomainOutbox.attempts, 0) >= MAX_ATTEMPTS,
            )
        )
        or 0
    )
    active_leases = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutboxLease).where(
                DomainOutboxLease.locked_at.is_not(None),
                DomainOutboxLease.locked_at >= stale_before,
            )
        )
        or 0
    )
    stale_leases = int(
        await db.scalar(
            select(func.count()).select_from(DomainOutboxLease).where(
                DomainOutboxLease.locked_at.is_not(None),
                DomainOutboxLease.locked_at < stale_before,
            )
        )
        or 0
    )
    oldest = await db.scalar(
        select(func.min(DomainOutbox.created_at)).where(
            DomainOutbox.processed_at.is_(None)
        )
    )
    oldest_age_seconds = None
    if oldest is not None:
        oldest_age_seconds = max(0, int((now - oldest).total_seconds()))
    return {
        "pending": pending,
        "retryable": retryable,
        "poisoned": poisoned,
        "active_leases": active_leases,
        "stale_leases": stale_leases,
        "oldest_pending_at": oldest.isoformat() + "Z" if oldest else None,
        "oldest_pending_age_seconds": oldest_age_seconds,
        "max_attempts": MAX_ATTEMPTS,
        "lease_ttl_seconds": int(LEASE_TTL.total_seconds()),
    }


async def _expand_acceptance_side_effects(
    db: AsyncSession,
    row: DomainOutbox,
    payload: dict,
) -> None:
    from app.models.entities import Payment, Project, Stage
    from app.services.accept_orchestrator import project_member_ids

    project = await db.get(Project, payload["project_id"])
    stage = await db.get(Stage, payload["stage_id"])
    if not project or not stage:
        raise RuntimeError("acceptance_outbox_target_missing")

    payment = None
    if payload.get("payment_id"):
        payment = await db.get(Payment, payload["payment_id"])
        if payment is None:
            raise RuntimeError("acceptance_outbox_payment_missing")

    next_stage = None
    if payload.get("next_stage_id"):
        next_stage = await db.get(Stage, payload["next_stage_id"])
        if next_stage is None or next_stage.project_id != project.id:
            raise RuntimeError("acceptance_outbox_next_stage_missing")

    accepted_by = payload.get("accepted_by") or ""
    comment = payload.get("comment")
    source = payload.get("source") or "app"
    title_suffix = " (портал)" if source == "portal" else ""
    members = project_member_ids(project)

    effects: list[tuple[str, str, dict]] = [
        (
            "activity:acceptance-passed",
            ACTIVITY_EVENT,
            {
                "project_id": project.id,
                "user_id": accepted_by,
                "kind": "AcceptancePassed",
                "title": f"Этап принят{title_suffix}: {stage.name}",
                "body": comment,
                "link_path": f"/stage/{stage.id}",
            },
        ),
        (
            "activity:stage-closed",
            ACTIVITY_EVENT,
            {
                "project_id": project.id,
                "user_id": accepted_by,
                "kind": "StageClosed",
                "title": f"Этап закрыт{title_suffix}: {stage.name}",
                "body": comment,
                "link_path": f"/stage/{stage.id}",
            },
        ),
    ]

    for member_id in members:
        if member_id != accepted_by:
            effects.append(
                (
                    f"notification:accepted:{member_id}",
                    NOTIFICATION_EVENT,
                    {
                        "user_id": member_id,
                        "project_id": project.id,
                        "notification_type": "stage_review",
                        "title": f"Этап принят: {stage.name}",
                        "body": comment or "Работы по этапу приняты заказчиком.",
                        "link_path": f"/stage/{stage.id}",
                        "return_to": "/(customer)/(tabs)/home",
                    },
                )
            )

    if payment is not None and project.customer_id:
        effects.append(
            (
                f"notification:payment:{project.customer_id}",
                NOTIFICATION_EVENT,
                {
                    "user_id": project.customer_id,
                    "project_id": project.id,
                    "notification_type": "payment_pending",
                    "title": "Подтвердите оплату этапа",
                    "body": stage.name,
                    "link_path": "/(customer)/(tabs)/budget?tab=payments",
                    "return_to": "/(customer)/(tabs)/home",
                },
            )
        )

    for member_id in members:
        effects.append(
            (
                f"notification:document:{member_id}",
                NOTIFICATION_EVENT,
                {
                    "user_id": member_id,
                    "project_id": project.id,
                    "notification_type": "document",
                    "title": f"Акт приёмки готов: {stage.name}",
                    "body": "PDF сформирован автоматически после приёмки",
                    "link_path": "/documents",
                    "return_to": (
                        "/(customer)/(tabs)/home"
                        if member_id == project.customer_id
                        else "/(contractor)/(tabs)/home"
                    ),
                },
            )
        )

    if next_stage is not None:
        for member_id in members:
            effects.append(
                (
                    f"notification:next-stage:{member_id}",
                    NOTIFICATION_EVENT,
                    {
                        "user_id": member_id,
                        "project_id": project.id,
                        "notification_type": "stage_started",
                        "title": f"Следующий этап: {next_stage.name}",
                        "body": "Этап автоматически переведён в работу после приёмки предыдущего.",
                        "link_path": f"/stage/{next_stage.id}",
                        "return_to": "/(customer)/(tabs)/repair",
                    },
                )
            )

    for effect_key, event_type, effect_payload in effects:
        await enqueue_once(
            db,
            parent_outbox_id=row.id,
            effect_key=effect_key,
            aggregate_type="work_acceptance_effect",
            aggregate_id=row.aggregate_id,
            event_type=event_type,
            payload=effect_payload,
        )


async def _handle(db: AsyncSession, row: DomainOutbox) -> None:
    payload = json.loads(row.payload_json or "{}")
    if row.event_type == ACCEPTANCE_SIDE_EFFECTS_EVENT:
        await _expand_acceptance_side_effects(db, row, payload)
        return

    if row.event_type in {PAYMENT_CREATED_EVENT, NOTIFICATION_EVENT}:
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

    if row.event_type in {RECEIPT_CREATED_EVENT, ACTIVITY_EVENT}:
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
