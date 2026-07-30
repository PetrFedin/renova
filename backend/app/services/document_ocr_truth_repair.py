"""Idempotent repair for legacy metadata-as-OCR states."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentVersion
from app.services.document_ocr_service import (
    OCR_DONE,
    OCR_PROCESSING,
    OCR_QUEUED,
    OCR_SUGGESTED,
    OCR_UNAVAILABLE,
)


async def repair_legacy_ocr_truth(db: AsyncSession) -> dict[str, int]:
    """Downgrade states created by the old filename-only OCR stub.

    Existing document_type is not automatically reverted because the system
    cannot distinguish an old automatic assignment from a later user edit.
    The suggestion is marked as non-authoritative and requires confirmation.
    """
    rows = list(
        (
            await db.execute(
                select(DocumentVersion).where(
                    DocumentVersion.ocr_status.in_((OCR_DONE, OCR_QUEUED, OCR_PROCESSING))
                )
            )
        ).scalars().all()
    )
    suggested = 0
    unavailable = 0
    for version in rows:
        if version.ocr_status == OCR_DONE:
            version.ocr_status = OCR_SUGGESTED
            version.ocr_job_id = None
            version.ocr_completed_at = None
            version.ocr_error = "legacy_metadata_classification_requires_review"
            suggested += 1
        else:
            version.ocr_status = OCR_UNAVAILABLE
            version.ocr_job_id = None
            version.ocr_completed_at = None
            version.ocr_error = "ocr_engine_not_configured"
            unavailable += 1
    await db.flush()
    return {
        "suggestions_repaired": suggested,
        "jobs_marked_unavailable": unavailable,
    }
