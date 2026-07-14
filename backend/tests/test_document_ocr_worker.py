"""Wave 3c: async OCR queue + worker tick."""
import pytest

from app.models.project_documents import DocumentType
from app.services.document_ocr_service import enqueue_ocr
from app.services.document_ocr_worker import process_queued_batch
from app.services.project_document_service import create_document, get_current_version


@pytest.mark.asyncio
async def test_worker_processes_queued(db):
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

    result = await process_queued_batch(db, limit=10)
    assert result["claimed"] == 1
    assert result["processed"] == 1
    await db.refresh(version)
    await db.refresh(doc)
    assert version.ocr_status == "done"
    assert doc.document_type == DocumentType.contract.value
