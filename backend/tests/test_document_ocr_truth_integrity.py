from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.project_documents import DocumentType, DocumentVersion
import app.models.client_write_request  # noqa: F401
import app.models.entities  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services.document_ocr_runtime import (
    DocumentOcrConfigurationError,
    validate_document_ocr_runtime,
)
from app.services.document_ocr_service import (
    OCR_CONFIRMED,
    OCR_SUGGESTED,
    OCR_UNAVAILABLE,
    confirm_metadata_suggestion,
    enqueue_and_run,
    ocr_dict,
)
from app.services.document_ocr_truth_repair import repair_legacy_ocr_truth
from app.services.project_document_service import create_document, get_current_version


@pytest_asyncio.fixture
async def ocr_db(monkeypatch):
    monkeypatch.setattr(settings, "document_ocr_mode", "metadata")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_metadata_suggestion_never_claims_content_ocr_or_auto_applies(ocr_db):
    doc = await create_document(
        ocr_db,
        project_id="ocr-project-1",
        created_by="ocr-user-1",
        title="Договор подряда",
        document_type=DocumentType.upload.value,
        storage_key="documents/ocr-project-1/contract.pdf",
        mime_type="application/pdf",
    )
    version = await get_current_version(ocr_db, doc.id)
    assert version is not None

    # Upload still passes apply_type=True in the legacy route. First call must suggest only.
    await enqueue_and_run(ocr_db, doc, version, apply_type=True)

    assert version.ocr_status == OCR_SUGGESTED
    assert version.ocr_suggested_type == DocumentType.contract.value
    assert version.ocr_completed_at is None
    assert doc.document_type == DocumentType.upload.value
    payload = ocr_dict(version)
    assert payload["source"] == "metadata"
    assert payload["content_read"] is False
    assert payload["engine_available"] is False
    assert payload["applied"] is False
    assert payload["requires_confirmation"] is True


@pytest.mark.asyncio
async def test_second_explicit_apply_request_is_the_only_type_transition(ocr_db):
    doc = await create_document(
        ocr_db,
        project_id="ocr-project-2",
        created_by="ocr-user-2",
        title="Смета ремонта",
        document_type=DocumentType.upload.value,
        storage_key="documents/ocr-project-2/estimate.pdf",
        mime_type="application/pdf",
    )
    version = await get_current_version(ocr_db, doc.id)
    await enqueue_and_run(ocr_db, doc, version, apply_type=False)
    assert doc.document_type == DocumentType.upload.value
    assert version.ocr_status == OCR_SUGGESTED

    # This represents an authenticated second POST with apply_type=true.
    await enqueue_and_run(ocr_db, doc, version, apply_type=True)

    assert doc.document_type == DocumentType.estimate.value
    assert version.ocr_status == OCR_CONFIRMED
    assert version.ocr_completed_at is not None
    payload = ocr_dict(version)
    assert payload["source"] == "metadata"
    assert payload["content_read"] is False
    assert payload["applied"] is True
    assert payload["requires_confirmation"] is False

    with pytest.raises(ValueError, match="metadata_suggestion_not_ready"):
        await confirm_metadata_suggestion(ocr_db, doc, version)


@pytest.mark.asyncio
async def test_off_mode_does_not_compute_or_apply_suggestions(ocr_db, monkeypatch):
    monkeypatch.setattr(settings, "document_ocr_mode", "off")
    doc = await create_document(
        ocr_db,
        project_id="ocr-project-off",
        created_by="ocr-user-off",
        title="Договор который нельзя анализировать",
        document_type=DocumentType.upload.value,
        storage_key="documents/ocr-project-off/contract.pdf",
        mime_type="application/pdf",
    )
    version = await get_current_version(ocr_db, doc.id)

    await enqueue_and_run(ocr_db, doc, version, apply_type=True)

    assert version.ocr_status == OCR_UNAVAILABLE
    assert version.ocr_suggested_type is None
    assert version.ocr_confidence is None
    assert version.ocr_error == "ocr_engine_not_configured"
    assert doc.document_type == DocumentType.upload.value


@pytest.mark.asyncio
async def test_legacy_stub_states_are_downgraded_idempotently(ocr_db):
    done = DocumentVersion(
        document_id="legacy-doc-done",
        version_number=1,
        ocr_status="done",
        ocr_suggested_type=DocumentType.invoice.value,
        ocr_confidence=0.75,
    )
    queued = DocumentVersion(document_id="legacy-doc-queued", version_number=1, ocr_status="queued")
    processing = DocumentVersion(document_id="legacy-doc-processing", version_number=1, ocr_status="processing")
    ocr_db.add_all([done, queued, processing])
    await ocr_db.flush()

    result = await repair_legacy_ocr_truth(ocr_db)

    assert result == {"suggestions_repaired": 1, "jobs_marked_unavailable": 2}
    assert done.ocr_status == OCR_SUGGESTED
    assert done.ocr_completed_at is None
    assert done.ocr_error == "legacy_metadata_classification_requires_review"
    assert queued.ocr_status == OCR_UNAVAILABLE
    assert processing.ocr_status == OCR_UNAVAILABLE
    assert queued.ocr_error == "ocr_engine_not_configured"

    replay = await repair_legacy_ocr_truth(ocr_db)
    assert replay == {"suggestions_repaired": 0, "jobs_marked_unavailable": 0}


def test_runtime_accepts_only_truthful_modes(monkeypatch):
    monkeypatch.setattr(settings, "document_ocr_mode", "metadata")
    assert validate_document_ocr_runtime() == "metadata"
    monkeypatch.setattr(settings, "document_ocr_mode", "off")
    assert validate_document_ocr_runtime() == "off"
    for mode in ("sync", "async", "stub", "demo", "unknown"):
        monkeypatch.setattr(settings, "document_ocr_mode", mode)
        with pytest.raises(DocumentOcrConfigurationError):
            validate_document_ocr_runtime()


def test_source_contract_contains_no_stub_success_or_background_worker():
    backend = Path(__file__).parents[1]
    service = (backend / "app" / "services" / "document_ocr_service.py").read_text(encoding="utf-8")
    main = (backend / "app" / "main.py").read_text(encoding="utf-8")
    schema = (backend / "app" / "schemas" / "project_documents.py").read_text(encoding="utf-8")
    worker = (backend / "app" / "services" / "document_ocr_worker.py").read_text(encoding="utf-8")

    assert 'version.ocr_status = "done"' not in service
    assert "doc.document_type = suggested" not in service
    assert "confirm_metadata_suggestion" in service
    assert 'document_ocr_mode: str = "metadata"' in (
        backend / "app" / "core" / "config.py"
    ).read_text(encoding="utf-8")
    assert "ocr_worker_loop" not in main
    assert "apply_type: bool = False" in schema
    assert "with_for_update(skip_locked=True)" in worker
