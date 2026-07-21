"""OCR / auto-classify stub (Wave 3b).

Зачем:
- После upload документ часто type=upload — нужен задел на авто-тип.
- Реальный OCR (Tesseract/облако) подключим позже; сейчас эвристики + job flags.
- Поля ocr_* на DocumentVersion готовы к async worker (queued → processing → done).
"""
from __future__ import annotations

from app.core.timeutil import utc_now
import re
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentType, DocumentVersion, ProjectDocument

# title/filename → suggested type (RU+EN)
_RULES: list[tuple[re.Pattern[str], str, float]] = [
    (re.compile(r"договор|contract|соглашен", re.I), DocumentType.contract.value, 0.82),
    (re.compile(r"акт\b|acceptance|приёмк|приемк", re.I), DocumentType.acceptance_act.value, 0.8),
    (re.compile(r"смет|estimate|калькуляц", re.I), DocumentType.estimate.value, 0.78),
    (re.compile(r"сч[её]т|invoice|инвойс", re.I), DocumentType.invoice.value, 0.75),
    (re.compile(r"гарант|warranty", re.I), DocumentType.warranty.value, 0.8),
    (re.compile(r"чек|receipt|квитанц", re.I), DocumentType.receipt.value, 0.77),
    (re.compile(r"дизайн|design.?pack", re.I), DocumentType.design_package.value, 0.7),
]

APPLY_MIN_CONFIDENCE = 0.7


def classify_heuristic(*, title: str, filename: str | None, mime_type: str | None) -> tuple[str, float]:
    """Вернуть (suggested_type, confidence) без реального OCR."""
    blob = f"{title or ''} {filename or ''}"
    for pattern, dtype, conf in _RULES:
        if pattern.search(blob):
            return dtype, conf
    if mime_type == "application/pdf":
        return DocumentType.other.value, 0.4
    if (mime_type or "").startswith("image/"):
        return DocumentType.upload.value, 0.35
    return DocumentType.upload.value, 0.25


def ocr_dict(version: DocumentVersion | None) -> dict | None:
    if not version:
        return None
    return {
        "status": getattr(version, "ocr_status", "none") or "none",
        "job_id": getattr(version, "ocr_job_id", None),
        "suggested_type": getattr(version, "ocr_suggested_type", None),
        "confidence": getattr(version, "ocr_confidence", None),
        "completed_at": version.ocr_completed_at.isoformat()
        if getattr(version, "ocr_completed_at", None)
        else None,
        "error": getattr(version, "ocr_error", None),
    }


async def enqueue_ocr(db: AsyncSession, version: DocumentVersion) -> DocumentVersion:
    version.ocr_status = "queued"
    version.ocr_job_id = f"ocr-{uuid.uuid4().hex[:20]}"
    version.ocr_error = None
    version.ocr_suggested_type = None
    version.ocr_confidence = None
    version.ocr_completed_at = None
    await db.flush()
    return version


async def run_ocr_stub(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
    *,
    apply_type: bool = True,
) -> DocumentVersion:
    """Синхронный stub runner (MVP). Worker позже подхватит status=queued."""
    version.ocr_status = "processing"
    await db.flush()
    try:
        filename = None
        if version.storage_key:
            filename = version.storage_key.rsplit("/", 1)[-1]
        suggested, conf = classify_heuristic(
            title=doc.title or "",
            filename=filename,
            mime_type=version.mime_type,
        )
        version.ocr_suggested_type = suggested
        version.ocr_confidence = conf
        version.ocr_status = "done"
        version.ocr_completed_at = utc_now()
        version.ocr_error = None
        if (
            apply_type
            and conf >= APPLY_MIN_CONFIDENCE
            and doc.document_type in (DocumentType.upload.value, DocumentType.other.value)
            and suggested not in (DocumentType.upload.value, DocumentType.other.value)
        ):
            doc.document_type = suggested
        await db.flush()
    except Exception as exc:  # noqa: BLE001 — stub must not crash upload path
        version.ocr_status = "failed"
        version.ocr_error = str(exc)[:250]
        await db.flush()
    return version


async def enqueue_and_run(
    db: AsyncSession,
    doc: ProjectDocument,
    version: DocumentVersion,
    *,
    apply_type: bool = True,
) -> DocumentVersion:
    await enqueue_ocr(db, version)
    return await run_ocr_stub(db, doc, version, apply_type=apply_type)


def ocr_provider_name() -> str:
    """Имя провайдера без секретов."""
    from app.core.config import settings
    raw = (getattr(settings, "document_ocr_provider", None) or "heuristic").strip().lower()
    return raw or "heuristic"


def ocr_enabled() -> bool:
    from app.core.config import settings
    return bool(getattr(settings, "document_ocr_enabled", True))


def ocr_capability() -> dict:
    """Единственный SoT для UI: mode/available/configured/healthy.

    heuristic → mode=local (не DEMO).
    provider=demo → mode=demo только если явно задано.
    enabled=false / provider=none|off → mode=off.
    """
    from app.core.config import settings
    from app.services.service_capability import service_capability

    enabled = ocr_enabled()
    provider = ocr_provider_name()
    worker_mode = (settings.document_ocr_mode or "sync").strip().lower()

    if not enabled or provider in ("none", "off", ""):
        return service_capability(
            available=False,
            mode="off",
            configured=False,
            healthy=False,
            provider=provider if provider not in ("",) else None,
            message="OCR не настроен",
            extra={"run_allowed": False, "worker_mode": worker_mode},
        )

    if provider == "demo":
        return service_capability(
            available=True,
            mode="demo",
            configured=True,
            healthy=True,
            provider="demo",
            message="OCR в demo-режиме (эвристики без ML)",
            extra={"run_allowed": True, "worker_mode": worker_mode},
        )

    # Явный live/sandbox — только если ops выставил provider (будущий cloud OCR).
    # Не путать с HTTP 200 health: available следует из configured+healthy.
    if provider == "live":
        return service_capability(
            available=True,
            mode="live",
            configured=True,
            healthy=True,
            provider="live",
            message="OCR live provider",
            extra={"run_allowed": True, "worker_mode": worker_mode},
        )

    if provider == "sandbox":
        return service_capability(
            available=True,
            mode="sandbox",
            configured=True,
            healthy=True,
            provider="sandbox",
            message="OCR sandbox provider",
            extra={"run_allowed": True, "worker_mode": worker_mode},
        )

    if provider in ("heuristic", "local", "stub"):
        # Локальная эвристика — честный local, не demo
        return service_capability(
            available=True,
            mode="local",
            configured=True,
            healthy=True,
            provider="heuristic",
            message="Локальная эвристическая классификация (не cloud OCR)",
            extra={"run_allowed": True, "worker_mode": worker_mode},
        )

    # Зарезервировано под будущий cloud provider без credentials → error/off
    return service_capability(
        available=False,
        mode="error",
        configured=False,
        healthy=False,
        provider=provider,
        message=f"OCR provider «{provider}» не сконфигурирован",
        extra={"run_allowed": False, "worker_mode": worker_mode},
    )


def assert_ocr_run_allowed() -> dict:
    """Для POST /documents/.../ocr — 503 если capability недоступна."""
    from fastapi import HTTPException

    cap = ocr_capability()
    if not cap.get("available") or not cap.get("run_allowed", False):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "ocr_unavailable",
                "message": cap.get("message") or "OCR недоступен",
                "capability": {
                    "available": cap.get("available"),
                    "mode": cap.get("mode"),
                    "configured": cap.get("configured"),
                    "healthy": cap.get("healthy"),
                },
            },
        )
    return cap

