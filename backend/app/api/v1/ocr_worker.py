"""Metadata-classification compatibility worker endpoints."""
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
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read queue status without claiming or mutating rows."""
    queued = await list_queued_versions(db, limit=100)
    return {
        "mode": settings.document_ocr_mode,
        "engine_available": False,
        "source": "metadata",
        "content_read": False,
        "background_worker_enabled": False,
        "queued_count": len(queued),
        "queued_version_ids": [version.id for version in queued[:20]],
    }


@router.post("/worker/tick")
async def ocr_worker_tick(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Drain only legacy metadata jobs; never claim completed OCR."""
    result = await process_queued_batch(db, limit=50)
    await db.commit()
    return {
        "ok": True,
        "mode": settings.document_ocr_mode,
        "engine_available": False,
        **result,
    }
