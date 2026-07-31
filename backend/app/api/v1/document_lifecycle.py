"""Canonical document lifecycle routes with one local transaction."""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.models.project_documents import DocumentStatus, ProjectDocument
from app.schemas.project_documents import DocumentSignIn, LegalHoldIn
from app.services import document_lifecycle_service as lifecycle
from app.services import document_state_lifecycle_service as state_lifecycle
from app.services import project_document_service as documents

router = APIRouter(prefix="/projects", tags=["documents"])


async def _require_project_docs(
    db: AsyncSession,
    project_id: str,
    user: User,
):
    try:
        return await require_project(db, project_id, user, write=True)
    except HTTPException as error:
        if error.status_code in (403, 404):
            raise HTTPException(404, "document_or_project_not_found") from error
        raise


async def _get_document(
    db: AsyncSession,
    *,
    project_id: str,
    document_id: str,
    include_deleted: bool = False,
) -> ProjectDocument:
    document = await db.get(ProjectDocument, document_id)
    if not document or document.project_id != project_id:
        raise HTTPException(404, "document_not_found")
    if not include_deleted and document.status == DocumentStatus.deleted.value:
        raise HTTPException(404, "document_not_found")
    return document


def _raise_sign_error(error: ValueError) -> None:
    message = str(error)
    if message.startswith("provider_unavailable:"):
        provider = message.split(":", 1)[-1]
        raise HTTPException(
            501,
            detail={
                "code": "esign_provider_unavailable",
                "provider": provider,
                "message": (
                    f"Электронная подпись «{provider}» не подключена. "
                    "Используйте подпись в приложении или настройте провайдера."
                ),
            },
        ) from error
    if message.startswith("unknown_esign_provider:"):
        raise HTTPException(400, message) from error
    if message in {"document_not_signable", "document_has_no_version"}:
        raise HTTPException(
            409,
            detail={
                "code": message,
                "message": (
                    "Архивный документ нельзя подписать."
                    if message == "document_not_signable"
                    else "У документа нет версии для подписи."
                ),
            },
        ) from error
    raise HTTPException(400, message) from error


def _raise_state_error(error: ValueError) -> None:
    message = str(error)
    status_code = 404 if message == "document_not_found" else 409
    raise HTTPException(
        status_code,
        detail={
            "code": message,
            "message": "Операция недоступна для текущего состояния документа.",
        },
    ) from error


@router.post("/{project_id}/documents/{document_id}/sign")
async def sign_project_document(
    project_id: str,
    document_id: str,
    body: DocumentSignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_docs(db, project_id, user)
    document = await _get_document(
        db,
        project_id=project_id,
        document_id=document_id,
    )
    try:
        signature, replayed = await lifecycle.sign_document(
            db,
            project=project,
            document=document,
            actor=user,
            signature_type=body.signature_type,
            content_hash=body.content_hash,
            provider=body.provider,
        )
    except ValueError as error:
        _raise_sign_error(error)
        raise AssertionError("unreachable") from error

    version = await documents.get_current_version(db, document.id)
    meta: dict = {}
    if signature.meta_json:
        try:
            meta = json.loads(signature.meta_json)
        except (TypeError, ValueError):
            meta = {}
    return {
        "signature_id": signature.id,
        "status": signature.status,
        "external_id": signature.provider_external_id,
        "signing_url": meta.get("signing_url"),
        "provider": signature.provider_name or signature.signature_type,
        "replayed": replayed,
        "document": documents.document_dict(document, version, [signature]),
    }


@router.post("/{project_id}/documents/{document_id}/archive")
async def archive_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_docs(db, project_id, user)
    document = await _get_document(
        db,
        project_id=project_id,
        document_id=document_id,
    )
    try:
        document, replayed = await lifecycle.archive_document(
            db,
            project=project,
            document=document,
            actor=user,
        )
    except ValueError as error:
        _raise_state_error(error)
        raise AssertionError("unreachable") from error

    version = await documents.get_current_version(db, document.id)
    result = documents.document_dict(document, version)
    result["replayed"] = replayed
    return result


@router.post("/{project_id}/documents/{document_id}/restore")
async def restore_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_docs(db, project_id, user)
    document = await _get_document(
        db,
        project_id=project_id,
        document_id=document_id,
        include_deleted=True,
    )
    try:
        document, replayed = await state_lifecycle.restore_document(
            db,
            project=project,
            document=document,
            actor=user,
        )
    except ValueError as error:
        _raise_state_error(error)
        raise AssertionError("unreachable") from error

    version = await documents.get_current_version(db, document.id)
    result = documents.document_dict(document, version)
    result["replayed"] = replayed
    return result


@router.delete("/{project_id}/documents/{document_id}")
async def delete_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_docs(db, project_id, user)
    document = await _get_document(
        db,
        project_id=project_id,
        document_id=document_id,
        include_deleted=True,
    )
    try:
        document, replayed = await state_lifecycle.delete_document(
            db,
            project=project,
            document=document,
            actor=user,
        )
    except ValueError as error:
        _raise_state_error(error)
        raise AssertionError("unreachable") from error

    return {
        "ok": True,
        "id": document.id,
        "status": DocumentStatus.deleted.value,
        "replayed": replayed,
    }


@router.post("/{project_id}/documents/{document_id}/legal-hold")
async def set_document_legal_hold(
    project_id: str,
    document_id: str,
    body: LegalHoldIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_docs(db, project_id, user)
    document = await _get_document(
        db,
        project_id=project_id,
        document_id=document_id,
        include_deleted=True,
    )
    retention = None
    if body.retention_until:
        try:
            retention = datetime.fromisoformat(
                body.retention_until.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except ValueError as error:
            raise HTTPException(400, "invalid_retention_until") from error
    try:
        document, replayed = await state_lifecycle.set_legal_hold(
            db,
            project=project,
            document=document,
            actor=user,
            enabled=body.enabled,
            retention_until=retention,
        )
    except ValueError as error:
        _raise_state_error(error)
        raise AssertionError("unreachable") from error

    version = await documents.get_current_version(db, document.id)
    result = documents.document_dict(document, version)
    result["replayed"] = replayed
    return result
