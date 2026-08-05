"""Metadata-classification worker operations for platform administrators."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services.document_ocr_worker import list_queued_versions, process_queued_batch

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.get("/worker")
async def ocr_worker_status(
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Read the global queue only for an allowlisted platform administrator."""
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
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Drain legacy global metadata jobs under explicit admin authorization."""
    result = await process_queued_batch(db, limit=50)
    await db.commit()
    return {
        "ok": True,
        "mode": settings.document_ocr_mode,
        "engine_available": False,
        **result,
    }
