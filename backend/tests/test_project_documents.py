"""Canonical ProjectDocument service smoke (D-01)."""
import pytest

from app.models.project_documents import DocumentType
from app.services.project_document_service import (
    create_document,
    ensure_acceptance_act_document,
    list_canonical_documents,
    sign_document,
)


@pytest.mark.asyncio
async def test_create_list_sign_document(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор подряда",
        document_type=DocumentType.contract.value,
        href="/files/contract.pdf",
    )
    await db.commit()

    items = await list_canonical_documents(db, "p1")
    assert len(items) == 1
    assert items[0]["title"] == "Договор подряда"
    assert items[0]["source"] == "canonical"
    assert items[0]["version"] == 1

    await sign_document(db, doc, signer_user_id="u1", signer_role="customer")
    await db.commit()
    items = await list_canonical_documents(db, "p1")
    assert len(items[0]["meta"]["signatures"]) == 1


@pytest.mark.asyncio
async def test_ensure_acceptance_idempotent(db):
    a = await ensure_acceptance_act_document(
        db,
        project_id="p1",
        stage_id="s1",
        stage_name="Демонтаж",
        acceptance_id="wa1",
        accepted_by="u1",
    )
    b = await ensure_acceptance_act_document(
        db,
        project_id="p1",
        stage_id="s1",
        stage_name="Демонтаж",
        acceptance_id="wa1",
        accepted_by="u1",
    )
    await db.commit()
    assert a.id == b.id


@pytest.mark.asyncio
async def test_archive_restore_and_signed_delete_blocked(db):
    from app.services.project_document_service import (
        archive_document,
        restore_document,
        soft_delete_document,
        sign_document,
    )

    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Гарантия",
        document_type=DocumentType.warranty.value,
        href="/files/w.pdf",
    )
    await archive_document(db, doc)
    await db.commit()
    assert doc.status == "archived"

    await restore_document(db, doc)
    await db.commit()
    assert doc.status == "active"

    await sign_document(db, doc, signer_user_id="u1", signer_role="customer")
    await db.commit()
    with pytest.raises(ValueError, match="signed_document_cannot_be_deleted"):
        await soft_delete_document(db, doc)


@pytest.mark.asyncio
async def test_save_bytes_local(tmp_path, monkeypatch):
    from app.core import config as cfg
    from app.services import storage_service as storage_svc

    monkeypatch.setattr(cfg.settings, "uploads_dir", str(tmp_path))
    monkeypatch.setattr(cfg.settings, "s3_endpoint", None)
    monkeypatch.setattr(cfg.settings, "public_base_url", "http://127.0.0.1:8100")

    key, href = await storage_svc.save_bytes(
        b"%PDF-1.4 test",
        folder="documents/p1",
        filename="act.pdf",
        content_type="application/pdf",
    )
    assert key.startswith("documents/p1/")
    assert href.endswith(key) or key in href
    data = await storage_svc.read_bytes(key)
    assert data.startswith(b"%PDF")


def test_presigned_url_no_recursion():
    from app.services.storage_service import generate_cloudfront_signed_url, presigned_url

    assert generate_cloudfront_signed_url("documents/p/a.txt") is None
    assert presigned_url("documents/p/a.txt") is None



@pytest.mark.asyncio
async def test_legal_hold_blocks_soft_delete(db):
    from app.services.project_document_service import (
        create_document,
        set_legal_hold,
        soft_delete_document,
    )

    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Hold me",
        document_type=DocumentType.contract.value,
    )
    await set_legal_hold(db, doc, enabled=True)
    with pytest.raises(ValueError, match="legal_hold_blocks_delete"):
        await soft_delete_document(db, doc)
    await set_legal_hold(db, doc, enabled=False)
    await soft_delete_document(db, doc)
    assert doc.status == "deleted"
