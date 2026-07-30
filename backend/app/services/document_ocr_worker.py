"""Compatibility worker for legacy metadata-classification queues.

This worker does not perform OCR. It converts old queued rows into explicit
metadata suggestions without mutating the canonical document type.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentVersion, ProjectDocument
from app.services.document_ocr_service import (
    OCR_FAILED,
    OCR_PROCESSING,
    OCR_QUEUED,
    suggest_from_metadata,
)

logger = logging.getLogger(__name__)


async def claim_queued_versions(db: AsyncSession, *, limit: int = 20) -> list[DocumentVersion]:
    """Claim rows transactionally; PostgreSQL workers skip already locked rows."""
    query = (
        select(DocumentVersion)
        .where(DocumentVersion.ocr_status == OCR_QUEUED)
        .order_by(DocumentVersion.created_at.asc(), DocumentVersion.id.asc())
        .limit(max(1, min(int(limit), 100)))
    )
    try:
        query = query.with_for_update(skip_locked=True)
    except Exception:
        query = query.with_for_update()
    versions = list((await db.execute(query)).scalars().all())
    for version in versions:
        version.ocr_status = OCR_PROCESSING
    if versions:
        await db.flush()
    return versions


async def list_queued_versions(db: AsyncSession, *, limit: int = 20) -> list[DocumentVersion]:
    """Backward-compatible alias that now performs a real claim."""
    return await claim_queued_versions(db, limit=limit)


async def process_queued_batch(
    db: AsyncSession,
    *,
    limit: int = 20,
    apply_type: bool = False,
) -> dict:
    """Convert claimed legacy jobs into non-authoritative metadata suggestions."""
    _ = apply_type
    versions = await claim_queued_versions(db, limit=limit)
    processed = 0
    failed = 0
    for version in versions:
        doc = await db.get(ProjectDocument, version.document_id)
        if not doc:
            version.ocr_status = OCR_FAILED
            version.ocr_error = "document_missing"
            failed += 1
            continue
        await suggest_from_metadata(db, doc, version)
        processed += 1
        if version.ocr_status == OCR_FAILED:
            failed += 1
    await db.flush()
    return {
        "claimed": len(versions),
        "processed": processed,
        "failed": failed,
        "remaining_hint": "queued_others_if_any",
        "source": "metadata",
        "content_read": False,
    }


async def ocr_worker_loop(stop_event: asyncio.Event, *, interval_sec: float = 5.0) -> None:
    """Drain legacy queued rows; new production configurations do not start it."""
    from app.db.session import SessionLocal

    logger.info("metadata classification worker started interval=%s", interval_sec)
    while not stop_event.is_set():
        try:
            async with SessionLocal() as db:
                result = await process_queued_batch(db, limit=20)
                if result["claimed"]:
                    await db.commit()
                    logger.info("metadata classification worker tick: %s", result)
                else:
                    await db.rollback()
        except Exception:
            logger.exception("metadata classification worker tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_sec)
        except asyncio.TimeoutError:
            continue
    logger.info("metadata classification worker stopped")
