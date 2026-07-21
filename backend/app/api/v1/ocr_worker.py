"""OCR worker ops + health capability (truthful modes)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services.document_ocr_service import ocr_capability
from app.services.document_ocr_worker import list_queued_versions, process_queued_batch

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.get("/health")
async def ocr_health(_user: User = Depends(get_current_user)):
    """Capability SoT для Document Center. Без секретов и внутренних URL."""
    _ = _user
    cap = ocr_capability()
    return {
        "environment": settings.normalized_environment,
        **cap,
        # Обратная совместимость со старыми клиентами, читавшими worker.mode
        "document_ocr_mode": settings.document_ocr_mode,
    }


@router.get("/worker")
async def ocr_worker_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Очередь worker + capability (расширение контракта, поля mode/queued_* сохранены)."""
    _ = user
    queued = await list_queued_versions(db, limit=100)
    cap = ocr_capability()
    return {
        "mode": settings.document_ocr_mode,
        "interval_sec": settings.document_ocr_worker_interval_sec,
        "queued_count": len(queued),
        "queued_version_ids": [v.id for v in queued[:20]],
        "capability": cap,
    }


@router.post("/worker/tick")
async def ocr_worker_tick(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Слить очередь queued → done (stub runner). Нужен для async-режима и e2e."""
    _ = user
    cap = ocr_capability()
    if not cap.get("available"):
        return {"ok": False, "mode": settings.document_ocr_mode, "capability": cap, "claimed": 0, "processed": 0, "failed": 0}
    result = await process_queued_batch(db, limit=50)
    await db.commit()
    return {"ok": True, "mode": settings.document_ocr_mode, "capability": cap, **result}
