"""Legacy queue processing must remain metadata-only and non-authoritative."""
import pytest

from app.models.project_documents import DocumentType
from app.services.document_ocr_service import OCR_SUGGESTED, enqueue_ocr
from app.services.document_ocr_worker import process_queued_batch
from app.services.project_document_service import create_document, get_current_version


@pytest.mark.asyncio
async def test_worker_converts_queue_to_metadata_suggestion_without_auto_type(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор подряда async",
        document_type=DocumentType.upload.value,
    )
    version = await get_current_version(db, doc.id)
    assert version is not None
    await enqueue_ocr(db, version)
    await db.commit()
    assert version.ocr_status == "queued"

    result = await process_queued_batch(db, limit=10, apply_type=True)
    assert result == {
        "claimed": 1,
        "processed": 1,
        "failed": 0,
        "remaining_hint": "queued_others_if_any",
        "source": "metadata",
        "content_read": False,
    }
    await db.refresh(version)
    await db.refresh(doc)
    assert version.ocr_status == OCR_SUGGESTED
    assert version.ocr_suggested_type == DocumentType.contract.value
    assert doc.document_type == DocumentType.upload.value

    replay = await process_queued_batch(db, limit=10)
    assert replay["claimed"] == 0
    assert replay["processed"] == 0
