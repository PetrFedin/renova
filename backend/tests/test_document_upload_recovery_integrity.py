"""P0 #316: multipart document upload is one entity + one deterministic blob."""

from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from starlette.datastructures import Headers

from app.api.v1 import document_upload_integrity as upload_api
from app.api.v1.document_upload_integrity import upload_project_document_integrity
from app.api.v1.router import api_router
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, User, UserRole
from app.models.project_documents import DocumentVersion, ProjectDocument

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990008401", role=UserRole.customer, full_name="Upload customer")
    db.add(customer)
    await db.flush()
    project = Project(
        name="Upload replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(project)
    await db.commit()
    return customer, project


def _upload(data: bytes, name: str = "contract.pdf") -> UploadFile:
    return UploadFile(
        file=BytesIO(data),
        filename=name,
        headers=Headers({"content-type": "application/pdf"}),
    )


async def _install_fake_storage(monkeypatch):
    objects: dict[str, bytes] = {}
    writes: list[str] = []
    deletes: list[str] = []

    async def fake_write(key: str, data: bytes, *, content_type: str = "application/octet-stream"):
        objects[key] = bytes(data)
        writes.append(key)
        return key

    async def fake_read(key: str):
        return objects.get(key)

    async def fake_delete(key: str):
        objects.pop(key, None)
        deletes.append(key)

    async def fake_ocr(db, document, version, *, apply_type=False):
        return version

    monkeypatch.setattr(upload_api.storage_svc, "write_bytes_at_key", fake_write)
    monkeypatch.setattr(upload_api.storage_svc, "read_bytes", fake_read)
    monkeypatch.setattr(upload_api, "delete_key_best_effort", fake_delete)
    monkeypatch.setattr(upload_api.ocr_svc, "enqueue_and_run", fake_ocr)
    monkeypatch.setattr(upload_api.ocr_svc, "enqueue_ocr", lambda db, version: fake_ocr(db, None, version))
    return objects, writes, deletes


async def test_upload_response_loss_replay_uses_one_document_version_and_blob(db, monkeypatch):
    customer, project = await _fixture(db)
    objects, writes, _ = await _install_fake_storage(monkeypatch)
    request_id = "document-upload-response-loss-0001"
    data = b"%PDF-1.4 replay safe upload"

    first = await upload_project_document_integrity(
        project.id,
        _upload(data),
        title="Договор",
        document_type="upload",
        client_request_id=request_id,
        user=customer,
        db=db,
    )
    replay = await upload_project_document_integrity(
        project.id,
        _upload(data),
        title="Договор",
        document_type="upload",
        client_request_id=request_id,
        user=customer,
        db=db,
    )

    assert first["idempotent_replay"] is False
    assert replay["idempotent_replay"] is True
    assert replay["id"] == first["id"]
    assert len(writes) == 1
    assert len(objects) == 1

    document_count = await db.scalar(
        select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id == project.id)
    )
    version_count = await db.scalar(
        select(func.count()).select_from(DocumentVersion).join(
            ProjectDocument, ProjectDocument.id == DocumentVersion.document_id
        ).where(ProjectDocument.project_id == project.id)
    )
    ledger_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "document.upload",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == request_id,
        )
    )
    assert document_count == 1
    assert version_count == 1
    assert ledger_count == 1

    version = await db.scalar(
        select(DocumentVersion).join(ProjectDocument).where(ProjectDocument.id == first["id"])
    )
    assert version is not None
    assert version.storage_key in objects
    canonical_key = version.storage_key

    # Storage loss is repaired at the SAME canonical key on replay.
    objects.pop(canonical_key)
    repaired = await upload_project_document_integrity(
        project.id,
        _upload(data),
        title="Договор",
        document_type="upload",
        client_request_id=request_id,
        user=customer,
        db=db,
    )
    assert repaired["id"] == first["id"]
    assert writes == [canonical_key, canonical_key]
    assert objects[canonical_key] == data


async def test_upload_same_request_id_different_bytes_conflicts_before_blob_overwrite(db, monkeypatch):
    customer, project = await _fixture(db)
    objects, writes, _ = await _install_fake_storage(monkeypatch)
    request_id = "document-upload-conflict-0001"
    original = b"%PDF original bytes"

    first = await upload_project_document_integrity(
        project.id,
        _upload(original),
        title="Договор",
        client_request_id=request_id,
        user=customer,
        db=db,
    )
    version = await db.scalar(
        select(DocumentVersion).join(ProjectDocument).where(ProjectDocument.id == first["id"])
    )
    assert version is not None
    canonical_key = version.storage_key

    with pytest.raises(HTTPException) as exc_info:
        await upload_project_document_integrity(
            project.id,
            _upload(b"%PDF changed bytes"),
            title="Договор",
            client_request_id=request_id,
            user=customer,
            db=db,
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"
    assert writes == [canonical_key]
    assert objects[canonical_key] == original


def test_upload_runtime_has_one_canonical_handler():
    path = "/api/v1/projects/{project_id}/documents/upload"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("document_upload_integrity")
