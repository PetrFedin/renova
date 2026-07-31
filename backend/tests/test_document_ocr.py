"""Document metadata classification remains truthful and confirmation-gated."""
import pytest

from app.models.project_documents import DocumentType
from app.services.document_ocr_service import classify_heuristic, enqueue_and_run
from app.services.project_document_service import create_document, get_current_version


def test_classify_contract_from_title():
    document_type, confidence = classify_heuristic(
        title="Договор подряда",
        filename=None,
        mime_type="application/pdf",
    )
    assert document_type == DocumentType.contract.value
    assert confidence >= 0.7


def test_classify_fallback_image():
    document_type, confidence = classify_heuristic(
        title="фото",
        filename="img.jpg",
        mime_type="image/jpeg",
    )
    assert document_type == DocumentType.upload.value
    assert confidence < 0.5


@pytest.mark.asyncio
async def test_metadata_suggestion_requires_explicit_confirmation(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Акт приёмки этапа",
        document_type=DocumentType.upload.value,
    )
    version = await get_current_version(db, doc.id)
    assert version is not None

    await enqueue_and_run(db, doc, version, apply_type=True)
    assert version.ocr_status == "suggested"
    assert version.ocr_suggested_type == DocumentType.acceptance_act.value
    assert doc.document_type == DocumentType.upload.value

    await enqueue_and_run(db, doc, version, apply_type=True)
    assert version.ocr_status == "confirmed"
    assert doc.document_type == DocumentType.acceptance_act.value
