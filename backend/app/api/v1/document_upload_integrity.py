"""Replay-safe multipart ProjectDocument upload.

The binary object uses a deterministic key derived from the first client command
and content checksum. DB entity/version/request-ledger commit exactly once. A
replay repairs a missing/corrupt object at the canonical key without creating a
second document or blob.
"""
from __future__ import annotations

import hashlib
import mimetypes
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.documents import ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, require_project_docs
from app.core.config import settings as app_settings
from app.db.session import get_db
from app.models.entities import User
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import document_ocr_service as ocr_svc
from app.services import project_document_service as docs_svc
from app.services import storage_service as storage_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.document_upload_storage import (
    delete_key_best_effort,
    deterministic_document_key,
    media_href,
)

router = APIRouter(prefix="/projects", tags=["documents"])
DOCUMENT_UPLOAD_SCOPE = "document.upload"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


def _idempotency_conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос загрузки уже использован с другими данными",
        },
    )


async def _canonical_document(
    db: AsyncSession,
    *,
    project_id: str,
    document_id: str,
) -> tuple[ProjectDocument, object]:
    document = await db.get(ProjectDocument, document_id)
    if not document or document.project_id != project_id:
        raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    version = await docs_svc.get_current_version(db, document.id)
    if not version:
        raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    return document, version


async def _repair_canonical_blob_if_needed(version, data: bytes, checksum: str, content_type: str) -> None:
    key = getattr(version, "storage_key", None)
    if not key:
        raise HTTPException(409, detail={"code": "document_storage_key_missing"})
    existing = await storage_svc.read_bytes(key)
    if existing is None or hashlib.sha256(existing).hexdigest() != checksum:
        await storage_svc.write_bytes_at_key(key, data, content_type=content_type)


@router.post("/{project_id}/documents/upload")
async def upload_project_document_integrity(
    project_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    document_type: str = Form(DocumentType.upload.value),
    stage_id: str | None = Form(None),
    payment_id: str | None = Form(None),
    notes: str | None = Form(None),
    client_request_id: str = Form(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    if not _REQUEST_ID.fullmatch(client_request_id or ""):
        raise HTTPException(422, "invalid_client_request_id")

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty_file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file_too_large")

    content_type = (
        file.content_type
        or mimetypes.guess_type(file.filename or "")[0]
        or "application/octet-stream"
    )
    if content_type not in ALLOWED_UPLOAD_TYPES and not content_type.startswith("image/"):
        content_type = "application/octet-stream"

    checksum = hashlib.sha256(data).hexdigest()
    doc_title = (title or file.filename or "Загруженный документ").strip()[:255]
    normalized_type = document_type or DocumentType.upload.value
    payload = {
        "title": doc_title,
        "document_type": normalized_type,
        "stage_id": stage_id,
        "payment_id": payment_id,
        "notes": notes,
        "filename": file.filename or "file.bin",
        "mime_type": content_type,
        "file_size": len(data),
        "checksum_sha256": checksum,
    }

    try:
        replay_id = await replay_entity_id(
            db,
            scope=DOCUMENT_UPLOAD_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if replay_id:
        document, version = await _canonical_document(
            db,
            project_id=project_id,
            document_id=replay_id,
        )
        await _repair_canonical_blob_if_needed(version, data, checksum, content_type)
        result = docs_svc.document_dict(document, version)
        result["idempotent_replay"] = True
        return result

    storage_key = deterministic_document_key(
        project_id=project_id,
        user_id=user.id,
        request_id=client_request_id,
        checksum_sha256=checksum,
        filename=file.filename,
    )
    href = media_href(storage_key)
    await storage_svc.write_bytes_at_key(storage_key, data, content_type=content_type)

    # Everything before commit_client_write is definitely uncommitted DB state.
    # If it fails, storage cleanup is safe. Once commit begins, outcome may be
    # ambiguous and the deterministic blob must remain for replay/reconciliation.
    try:
        document = await docs_svc.create_document(
            db,
            project_id=project_id,
            created_by=user.id,
            title=doc_title,
            document_type=normalized_type,
            stage_id=stage_id,
            payment_id=payment_id,
            notes=notes,
            href=href,
            storage_key=storage_key,
            mime_type=content_type,
            file_size=len(data),
            checksum_sha256=checksum,
        )
        version = await docs_svc.get_current_version(db, document.id)
        if not version:
            raise RuntimeError("document_version_missing")
        mode = (app_settings.document_ocr_mode or "sync").strip().lower()
        if mode == "async":
            await ocr_svc.enqueue_ocr(db, version)
        else:
            await ocr_svc.enqueue_and_run(db, document, version, apply_type=True)
    except BaseException:
        await db.rollback()
        await delete_key_best_effort(storage_key)
        raise

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=DOCUMENT_UPLOAD_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=client_request_id,
            payload=payload,
            entity_id=document.id,
        )
    except IdempotencyConflict as exc:
        # A concurrent different-payload command won this request id. Our DB
        # candidate rolled back and its content-derived key cannot be canonical.
        await delete_key_best_effort(storage_key)
        raise _idempotency_conflict() from exc

    if not created:
        document, version = await _canonical_document(
            db,
            project_id=project_id,
            document_id=entity_id,
        )
        await _repair_canonical_blob_if_needed(version, data, checksum, content_type)
        result = docs_svc.document_dict(document, version)
        result["idempotent_replay"] = True
        return result

    version = await docs_svc.get_current_version(db, document.id)
    result = docs_svc.document_dict(document, version)
    result["idempotent_replay"] = False
    return result
