"""OCR queue worker (Wave 3c).

Зачем:
- В sync-режиме classify блокирует upload (MVP OK).
- В async — upload только ставит queued; worker доводит до done.
Реальный OCR-engine позже подменит run_ocr_stub без смены status machine.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentVersion, ProjectDocument
from app.services.document_ocr_service import run_ocr_stub

logger = logging.getLogger(__name__)


async def list_queued_versions(db: AsyncSession, *, limit: int = 20) -> list[DocumentVersion]:
    rows = (
        await db.execute(
            select(DocumentVersion)
            .where(DocumentVersion.ocr_status == "queued")
            .order_by(DocumentVersion.created_at.asc())
            .limit(limit)
        )
    ).scalars().all()
    return list(rows)


async def process_queued_batch(
    db: AsyncSession,
    *,
    limit: int = 20,
    apply_type: bool = True,
) -> dict:
    """Обработать пачку queued OCR. Возвращает счётчики для ops/e2e."""
    versions = await list_queued_versions(db, limit=limit)
    processed = 0
    failed = 0
    for version in versions:
        doc = await db.get(ProjectDocument, version.document_id)
        if not doc:
            version.ocr_status = "failed"
            version.ocr_error = "document_missing"
            failed += 1
            continue
        await run_ocr_stub(db, doc, version, apply_type=apply_type)
        processed += 1
        if version.ocr_status == "failed":
            failed += 1
    await db.flush()
    return {
        "claimed": len(versions),
        "processed": processed,
        "failed": failed,
        "remaining_hint": "queued_others_if_any",
    }


async def ocr_worker_loop(stop_event: asyncio.Event, *, interval_sec: float = 5.0) -> None:
    """Фоновый цикл для DOCUMENT_OCR_MODE=async."""
    from app.db.session import SessionLocal

    logger.info("OCR worker loop started interval=%s", interval_sec)
    while not stop_event.is_set():
        try:
            async with SessionLocal() as db:
                result = await process_queued_batch(db, limit=20)
                if result["claimed"]:
                    await db.commit()
                    logger.info("OCR worker tick: %s", result)
                else:
                    await db.rollback()
        except Exception:  # noqa: BLE001
            logger.exception("OCR worker tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_sec)
        except asyncio.TimeoutError:
            continue
    logger.info("OCR worker loop stopped")
