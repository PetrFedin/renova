"""Transactional outbox enqueue + best-effort dispatch (P1.16)."""
from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import DomainOutbox, _uuid

logger = logging.getLogger("renova.outbox")


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
        created_at=datetime.utcnow(),
    )
    db.add(row)
    await db.flush()
    return row


async def dispatch_pending(db: AsyncSession, *, limit: int = 20) -> int:
    """Process unprocessed outbox rows. Safe to call after commit."""
    rows = list(
        (
            await db.execute(
                select(DomainOutbox)
                .where(DomainOutbox.processed_at.is_(None))
                .order_by(DomainOutbox.created_at.asc())
                .limit(limit)
            )
        ).scalars().all()
    )
    done = 0
    for row in rows:
        try:
            await _handle(db, row)
            row.processed_at = datetime.utcnow()
            row.attempts = (row.attempts or 0) + 1
            done += 1
        except Exception as exc:  # noqa: BLE001 — isolate per row
            row.attempts = (row.attempts or 0) + 1
            row.last_error = str(exc)[:500]
            logger.exception("outbox failed id=%s type=%s", row.id, row.event_type)
    if rows:
        await db.commit()
    return done


async def _handle(db: AsyncSession, row: DomainOutbox) -> None:
    payload = json.loads(row.payload_json or "{}")
    if row.event_type == "acceptance.side_effects":
        from app.models.entities import Payment, Project, Stage
        from app.services.accept_orchestrator import emit_acceptance_side_effects

        project = await db.get(Project, payload["project_id"])
        stage = await db.get(Stage, payload["stage_id"])
        if not project or not stage:
            return
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
    logger.warning("unknown outbox event_type=%s", row.event_type)
