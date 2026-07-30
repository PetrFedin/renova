"""Legacy queue processing must remain metadata-only and non-authoritative."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.project_documents import DocumentType
import app.models.client_write_request  # noqa: F401
import app.models.entities  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services.document_ocr_service import OCR_SUGGESTED, enqueue_ocr
from app.services.document_ocr_worker import list_queued_versions, process_queued_batch
from app.services.project_document_service import create_document, get_current_version


@pytest_asyncio.fixture
async def worker_db(monkeypatch):
    monkeypatch.setattr(settings, "document_ocr_mode", "metadata")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_worker_converts_queue_to_metadata_suggestion_without_auto_type(worker_db):
    doc = await create_document(
        worker_db,
        project_id="p1",
        created_by="u1",
        title="Договор подряда async",
        document_type=DocumentType.upload.value,
    )
    version = await get_current_version(worker_db, doc.id)
    assert version is not None
    await enqueue_ocr(worker_db, version)
    await worker_db.commit()
    assert version.ocr_status == "queued"

    inspected = await list_queued_versions(worker_db, limit=10)
    assert [row.id for row in inspected] == [version.id]
    await worker_db.refresh(version)
    assert version.ocr_status == "queued"

    result = await process_queued_batch(worker_db, limit=10, apply_type=True)
    assert result == {
        "claimed": 1,
        "processed": 1,
        "failed": 0,
        "remaining_hint": "queued_others_if_any",
        "source": "metadata",
        "content_read": False,
    }
    await worker_db.refresh(version)
    await worker_db.refresh(doc)
    assert version.ocr_status == OCR_SUGGESTED
    assert version.ocr_suggested_type == DocumentType.contract.value
    assert doc.document_type == DocumentType.upload.value

    replay = await process_queued_batch(worker_db, limit=10)
    assert replay["claimed"] == 0
    assert replay["processed"] == 0
