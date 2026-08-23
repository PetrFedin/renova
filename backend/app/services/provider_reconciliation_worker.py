"""Background provider-read reconciliation loop."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import socket
import uuid

from app.db.session import SessionLocal
from app.models.provider_runtime import ProviderReconciliation
from app.services import provider_reconciliation_handlers as handlers
from app.services import provider_reconciliation_service as ledger

logger = logging.getLogger("renova.provider.reconciliation_worker")


def _worker_id() -> str:
    host = hashlib.sha256(socket.gethostname().encode("utf-8")).hexdigest()[:16]
    return f"provider:{host}:{uuid.uuid4().hex[:12]}"


async def run_provider_reconciliation_batch(
    *,
    worker_id: str,
    limit: int = 25,
) -> dict[str, int]:
    metrics = {
        "seeded": 0,
        "claimed": 0,
        "completed": 0,
        "deferred": 0,
        "failed": 0,
    }

    async with SessionLocal() as db:
        metrics["seeded"] = await handlers.seed_pending_provider_work(db, limit=100)
        await db.commit()

    async with SessionLocal() as db:
        claims = await ledger.claim_due(db, worker_id=worker_id, limit=limit)
        await db.commit()
    metrics["claimed"] = len(claims)

    for claim in claims:
        async with SessionLocal() as db:
            try:
                applied = await handlers.reconcile_claim(
                    db,
                    claim,
                    worker_id=worker_id,
                )
                if not applied:
                    await db.rollback()
                    metrics["failed"] += 1
                    continue
                await db.commit()
                current = await db.get(ProviderReconciliation, claim.id)
                if current and current.status == "retry":
                    metrics["deferred"] += 1
                else:
                    metrics["completed"] += 1
            except asyncio.CancelledError:
                await db.rollback()
                raise
            except Exception as exc:
                await db.rollback()
                async with SessionLocal() as retry_db:
                    if await ledger.mark_retry(
                        retry_db,
                        claim,
                        worker_id=worker_id,
                        error_code="provider_handler_exception",
                        error=exc,
                    ):
                        await retry_db.commit()
                        metrics["deferred"] += 1
                    else:
                        await retry_db.rollback()
                        metrics["failed"] += 1
                logger.exception(
                    "provider reconciliation handler failed provider=%s operation=%s resource_type=%s",
                    claim.provider,
                    claim.operation_type,
                    claim.resource_type,
                )
    return metrics


async def provider_reconciliation_worker_loop(
    stop: asyncio.Event,
    *,
    interval_sec: float = 30.0,
) -> None:
    worker_id = _worker_id()
    while not stop.is_set():
        try:
            metrics = await run_provider_reconciliation_batch(worker_id=worker_id)
            if any(metrics.values()):
                logger.info("provider reconciliation tick", extra=metrics)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("provider reconciliation worker tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(float(interval_sec), 1.0))
        except asyncio.TimeoutError:
            pass
