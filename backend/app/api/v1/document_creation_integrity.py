"""Atomic replay-safe ProjectDocument metadata creation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.documents import require_project_docs
from app.db.session import get_db
from app.models.entities import User
from app.models.project_documents import ProjectDocument
from app.schemas.project_documents import DocumentCreateIn
from app.services import project_document_service as docs_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)

router = APIRouter(prefix="/projects", tags=["documents"])
DOCUMENT_CREATE_SCOPE = "document.create"


class DocumentCreateCommand(DocumentCreateIn):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


def _idempotency_conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос документа уже использован с другими данными",
        },
    )


async def _canonical_document(
    db: AsyncSession,
    *,
    project_id: str,
    document_id: str,
) -> dict:
    document = await db.get(ProjectDocument, document_id)
    if not document or document.project_id != project_id:
        raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    version = await docs_svc.get_current_version(db, document.id)
    return docs_svc.document_dict(document, version)


@router.post("/{project_id}/documents")
async def create_project_document_integrity(
    project_id: str,
    body: DocumentCreateCommand,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    payload = body.model_dump(exclude={"client_request_id"}, mode="json")

    try:
        replay_id = await replay_entity_id(
            db,
            scope=DOCUMENT_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if replay_id:
        result = await _canonical_document(db, project_id=project_id, document_id=replay_id)
        result["idempotent_replay"] = True
        return result

    document = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user.id,
        title=body.title,
        document_type=body.document_type,
        stage_id=body.stage_id,
        payment_id=body.payment_id,
        notes=body.notes,
        href=body.href,
        storage_key=body.storage_key,
        mime_type=body.mime_type,
        file_size=body.file_size,
        checksum_sha256=body.checksum_sha256,
    )

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=DOCUMENT_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=document.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_conflict() from exc

    if not created:
        result = await _canonical_document(db, project_id=project_id, document_id=entity_id)
        result["idempotent_replay"] = True
        return result

    version = await docs_svc.get_current_version(db, document.id)
    result = docs_svc.document_dict(document, version)
    result["idempotent_replay"] = False
    return result
