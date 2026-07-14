"""Wave 3b: OCR classify stub heuristics + job flags."""
import pytest

from app.models.project_documents import DocumentType
from app.services.document_ocr_service import classify_heuristic, enqueue_and_run
from app.services.project_document_service import create_document, get_current_version


def test_classify_contract_from_title():
    t, c = classify_heuristic(title="Договор подряда", filename=None, mime_type="application/pdf")
    assert t == DocumentType.contract.value
    assert c >= 0.7


def test_classify_fallback_image():
    t, c = classify_heuristic(title="фото", filename="img.jpg", mime_type="image/jpeg")
    assert t == DocumentType.upload.value
    assert c < 0.5


@pytest.mark.asyncio
async def test_enqueue_and_run_applies_type(db):
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
    assert version.ocr_status == "done"
    assert version.ocr_suggested_type == DocumentType.acceptance_act.value
    assert doc.document_type == DocumentType.acceptance_act.value
