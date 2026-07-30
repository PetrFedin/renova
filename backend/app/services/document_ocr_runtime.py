"""Runtime policy for document analysis modes."""
from __future__ import annotations

from app.core.config import settings
from app.services.document_ocr_service import normalize_ocr_mode

_ALLOWED_MODES = frozenset({"off", "metadata"})
_LEGACY_STUB_MODES = frozenset({"sync", "async", "stub", "demo"})


class DocumentOcrConfigurationError(RuntimeError):
    pass


def validate_document_ocr_runtime() -> str:
    """Reject modes that would pretend metadata heuristics are content OCR."""
    mode = normalize_ocr_mode(settings.document_ocr_mode)
    if mode in _LEGACY_STUB_MODES:
        raise DocumentOcrConfigurationError(
            f"DOCUMENT_OCR_MODE={mode} is disabled: configure 'metadata' or 'off' until a real OCR engine is installed"
        )
    if mode not in _ALLOWED_MODES:
        raise DocumentOcrConfigurationError(
            f"Unknown DOCUMENT_OCR_MODE={mode}; allowed: off, metadata"
        )
    return mode
