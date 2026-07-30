"""Truthful document metadata classification without pretending content OCR."""
from __future__ import annotations

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.project_documents import DocumentType, DocumentVersion, ProjectDocument

OCR_NONE = "none"
OCR_QUEUED = "queued"
OCR_PROCESSING = "processing"
OCR_SUGGESTED = "suggested"
OCR_CONFIRMED = "confirmed"
OCR_UNAVAILABLE = "unavailable"
OCR_FAILED = "failed"
OCR_DONE = "done"  # reserved for a future engine that reads document content

_RULES: list[tuple[re.Pattern[str], str, float]] = [
    (re.compile(r"договор|contract|соглашен", re.I), DocumentType.contract.value, 0.82),
    (re.compile(r"акт\b|acceptance|при[её]мк", re.I), DocumentType.acceptance_act.value, 0.80),
    (re.compile(r"смет|estimate|калькуляц", re.I), DocumentType.estimate.value, 0.78),
    (re.compile(r"сч[её]т|invoice|инвойс", re.I), DocumentType.invoice.value, 0.75),
    (re.compile(r"гарант|warranty", re.I), DocumentType.warranty.value, 0.80),
    (re.compile(r"чек|receipt|квитанц", re.I), DocumentType.receipt.value, 0.77),
    (re.compile(r"дизайн|design.?pack", re.I), DocumentType.design_package.value, 0.70),
]


class OcrUnavailable(RuntimeError):
    pass


def normalize_ocr_mode(value: str | None) -> str:
    return (value or "metadata").strip().lower()


def classify_metadata(*, title: str, filename: str | None, mime_type: str | None) -> tuple[str, float]:
    """Suggest a type from metadata only; this function never reads file content."""
    blob = f"{title or ''} {filename or ''}"
    for pattern, document_type, confidence in _RULES:
        if pattern.search(blob):
            return document_type, confidence
    if mime_type == "application/pdf":
        return DocumentType.other.value, 0.40
    if (mime_type or "").startswith("image/"):
        return DocumentType.upload.value, 0.35
    return DocumentType.upload.value, 0.25


classify_heuristic = classify_metadata


def ocr_dict(version: DocumentVersion | None) -> dict | None:
    if not version:
        return None
    status = getattr(version, "ocr_status", OCR_NONE) or OCR_NONE
    source = "metadata" if status in {OCR_SUGGESTED, OCR_CONFIRMED} else None
    return {
        "status": status,
        "job_id": getattr(version, "ocr_job_id", None),
        "suggested_type": getattr(version, "ocr_suggested_type", None),
        "confidence": getattr(version, "ocr_confidence", None),
        "source": source,
        "content_read": status == OCR_DONE,
        "applied": status == OCR_CONFIRMED,
        "requires_confirmation": status == OCR_SUGGESTED,
        "engine_available": False,
        "completed_at": version.ocr_completed_at.isoformat()
        if getattr(version, "ocr_completed_at", None)
        else None,
        "error": getattr(version, "ocr_error", None),
    }


def _filename(version: DocumentVersion) -> str | None:
    if not version.storage_key:
        return None
    return version.storage_key.rsplit("/", 1)[-1]


async def suggest_from_metadata(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
) -> DocumentVersion:
    """Record a non-authoritative suggestion; never mutate document_type."""
    version.ocr_status = OCR_PROCESSING
    version.ocr_error = None
    await db.flush()
    try:
        suggested, confidence = classify_metadata(
            title=doc.title or "",
            filename=_filename(version),
            mime_type=version.mime_type,
        )
        version.ocr_suggested_type = suggested
        version.ocr_confidence = confidence
        version.ocr_status = OCR_SUGGESTED
        version.ocr_job_id = None
        version.ocr_completed_at = None
        version.ocr_error = None
        await db.flush()
    except Exception as exc:
        version.ocr_status = OCR_FAILED
        version.ocr_error = f"metadata_classification_failed:{type(exc).__name__}"[:255]
        version.ocr_completed_at = None
        await db.flush()
    return version


async def confirm_metadata_suggestion(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
) -> DocumentVersion:
    """Apply a metadata suggestion only after an explicit authenticated action."""
    if version.ocr_status != OCR_SUGGESTED or not version.ocr_suggested_type:
        raise ValueError("metadata_suggestion_not_ready")
    if version.ocr_suggested_type not in {item.value for item in DocumentType}:
        raise ValueError("metadata_suggestion_invalid")
    doc.document_type = version.ocr_suggested_type
    version.ocr_status = OCR_CONFIRMED
    version.ocr_completed_at = utc_now()
    version.ocr_error = None
    await db.flush()
    return version


async def mark_ocr_unavailable(db: AsyncSession, version: DocumentVersion) -> DocumentVersion:
    version.ocr_status = OCR_UNAVAILABLE
    version.ocr_job_id = None
    version.ocr_completed_at = None
    version.ocr_error = "ocr_engine_not_configured"
    await db.flush()
    return version


async def enqueue_ocr(db: AsyncSession, version: DocumentVersion) -> DocumentVersion:
    version.ocr_status = OCR_QUEUED
    version.ocr_job_id = f"metadata-{uuid.uuid4().hex[:20]}"
    version.ocr_error = None
    version.ocr_completed_at = None
    await db.flush()
    return version


async def run_ocr_stub(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
    *,
    apply_type: bool = False,
) -> DocumentVersion:
    """Deprecated path: first request suggests; a later explicit request may confirm."""
    if apply_type and version.ocr_status == OCR_SUGGESTED:
        return await confirm_metadata_suggestion(db, doc, version)
    return await suggest_from_metadata(db, doc, version)


async def enqueue_and_run(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
    *,
    apply_type: bool = False,
) -> DocumentVersion:
    """First call suggests only; apply_type confirms only an already visible suggestion."""
    if apply_type and version.ocr_status == OCR_SUGGESTED:
        return await confirm_metadata_suggestion(db, doc, version)
    await enqueue_ocr(db, version)
    return await suggest_from_metadata(db, doc, version)
