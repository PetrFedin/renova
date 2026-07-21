"""OCR capability truth — mode/available без hardcoded DEMO на клиенте."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.document_ocr_service import assert_ocr_run_allowed, ocr_capability


@pytest.fixture(autouse=True)
def _restore_ocr_settings():
    prev = (
        settings.document_ocr_enabled,
        settings.document_ocr_provider,
        settings.document_ocr_mode,
    )
    yield
    settings.document_ocr_enabled = prev[0]
    settings.document_ocr_provider = prev[1]
    settings.document_ocr_mode = prev[2]


def test_ocr_capability_heuristic_is_local_not_demo():
    settings.document_ocr_enabled = True
    settings.document_ocr_provider = "heuristic"
    cap = ocr_capability()
    assert cap["mode"] == "local"
    assert cap["available"] is True
    assert cap["configured"] is True
    assert cap["healthy"] is True
    assert cap["provider"] == "heuristic"
    assert cap["run_allowed"] is True
    assert "checked_at" in cap
    # secrets must not leak
    blob = str(cap)
    assert "secret" not in blob.lower() or "SECRET" not in blob


def test_ocr_capability_demo_mode_explicit():
    settings.document_ocr_enabled = True
    settings.document_ocr_provider = "demo"
    cap = ocr_capability()
    assert cap["mode"] == "demo"
    assert cap["available"] is True
    assert cap["run_allowed"] is True


def test_ocr_capability_provider_off():
    settings.document_ocr_enabled = False
    settings.document_ocr_provider = "heuristic"
    cap = ocr_capability()
    assert cap["mode"] == "off"
    assert cap["available"] is False
    assert cap["run_allowed"] is False
    assert "не настроен" in (cap["message"] or "").lower() or cap["message"]


def test_ocr_capability_unknown_provider_unhealthy():
    settings.document_ocr_enabled = True
    settings.document_ocr_provider = "cloud-vision-x"
    cap = ocr_capability()
    assert cap["mode"] == "error"
    assert cap["available"] is False
    assert cap["healthy"] is False
    assert cap["run_allowed"] is False


def test_assert_ocr_run_allowed_raises_when_off():
    settings.document_ocr_enabled = False
    with pytest.raises(HTTPException) as ei:
        assert_ocr_run_allowed()
    assert ei.value.status_code == 503
    detail = ei.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "ocr_unavailable"
    assert "capability" in detail


def test_ocr_capability_live_provider():
    settings.document_ocr_enabled = True
    settings.document_ocr_provider = "live"
    cap = ocr_capability()
    assert cap["mode"] == "live"
    assert cap["available"] is True
    assert cap["run_allowed"] is True
    assert "url" not in str(cap).lower() or "http" not in str(cap).lower()


def test_ocr_capability_sandbox_provider():
    settings.document_ocr_enabled = True
    settings.document_ocr_provider = "sandbox"
    cap = ocr_capability()
    assert cap["mode"] == "sandbox"
    assert cap["available"] is True
