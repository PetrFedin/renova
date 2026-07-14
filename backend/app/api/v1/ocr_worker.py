"""OCR worker ops endpoints (Wave 3c)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services.document_ocr_worker import list_queued_versions, process_queued_batch

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.get("/worker")
async def ocr_worker_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    queued = await list_queued_versions(db, limit=100)
    return {
        "mode": settings.document_ocr_mode,
        "interval_sec": settings.document_ocr_worker_interval_sec,
        "queued_count": len(queued),
        "queued_version_ids": [v.id for v in queued[:20]],
    }


@router.post("/worker/tick")
async def ocr_worker_tick(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Слить очередь queued → done (stub runner). Нужен для async-режима и e2e."""
    result = await process_queued_batch(db, limit=50)
    await db.commit()
    return {"ok": True, "mode": settings.document_ocr_mode, **result}
