"""Service layer for ProjectDocument lifecycle (D-01…D-07)."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)


def document_dict(doc: ProjectDocument, version: DocumentVersion | None = None, signatures: list[DocumentSignature] | None = None) -> dict:
    from app.services.document_ocr_service import ocr_dict

    return {
        "id": doc.id,
        "source": "canonical",
        "kind": doc.document_type,
        "title": doc.title,
        "status": doc.status,
        "href": version.href if version else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "amount": None,
        "verified": None,
        "version": version.version_number if version else None,
        "meta": {
            "project_id": doc.project_id,
            "stage_id": doc.stage_id,
            "payment_id": doc.payment_id,
            "receipt_id": doc.receipt_id,
            "change_order_id": doc.change_order_id,
            "work_acceptance_id": doc.work_acceptance_id,
            "current_version_id": doc.current_version_id,
            "notes": doc.notes,
            "legal_hold": bool(getattr(doc, "legal_hold", False)),
            "retention_until": doc.retention_until.isoformat() if getattr(doc, "retention_until", None) else None,
            "ocr": ocr_dict(version),
            "signatures": [
                {
                    "id": signature.id,
                    "signer_user_id": signature.signer_user_id,
                    "signer_role": signature.signer_role,
                    "signed_at": signature.signed_at.isoformat() if signature.signed_at else None,
                    "status": signature.status,
                    "provider": getattr(signature, "provider_name", None) or signature.signature_type,
                    "provider_name": getattr(signature, "provider_name", None) or signature.signature_type,
                    "signature_type": signature.signature_type,
                    "provider_external_id": getattr(signature, "provider_external_id", None),
                }
                for signature in (signatures or [])
            ],
        },
    }


async def get_current_version(db: AsyncSession, document_id: str) -> DocumentVersion | None:
    doc = await db.get(ProjectDocument, document_id)
    if not doc or not doc.current_version_id:
        return None
    return await db.get(DocumentVersion, doc.current_version_id)


async def list_canonical_documents(db: AsyncSession, project_id: str) -> list[dict]:
    rows = list(
        (
            await db.execute(
                select(ProjectDocument)
                .where(ProjectDocument.project_id == project_id)
                .where(ProjectDocument.status != DocumentStatus.deleted.value)
                .order_by(ProjectDocument.created_at.desc())
            )
        ).scalars().all()
    )
    result: list[dict] = []
    for doc in rows:
        version = await get_current_version(db, doc.id)
        signatures = list(
            (
                await db.execute(
                    select(DocumentSignature).where(DocumentSignature.document_id == doc.id)
                )
            ).scalars().all()
        )
        result.append(document_dict(doc, version, signatures))
    return result


async def create_document(
    db: AsyncSession,
    *,
    project_id: str,
    created_by: str | None,
    title: str,
    document_type: str = DocumentType.upload.value,
    stage_id: str | None = None,
    payment_id: str | None = None,
    receipt_id: str | None = None,
    change_order_id: str | None = None,
    work_acceptance_id: str | None = None,
    notes: str | None = None,
    href: str | None = None,
    storage_key: str | None = None,
    mime_type: str | None = None,
    file_size: int | None = None,
    checksum_sha256: str | None = None,
) -> ProjectDocument:
    doc = ProjectDocument(
        project_id=project_id,
        stage_id=stage_id,
        payment_id=payment_id,
        receipt_id=receipt_id,
        change_order_id=change_order_id,
        work_acceptance_id=work_acceptance_id,
        document_type=document_type,
        title=title,
        status=DocumentStatus.active.value,
        created_by=created_by,
        notes=notes,
    )
    db.add(doc)
    await db.flush()

    version = DocumentVersion(
        document_id=doc.id,
        version_number=1,
        storage_key=storage_key,
        mime_type=mime_type,
        file_size=file_size,
        checksum_sha256=checksum_sha256,
        href=href,
        created_by=created_by,
    )
    db.add(version)
    await db.flush()
    doc.current_version_id = version.id
    await db.flush()
    return doc


async def add_version(
    db: AsyncSession,
    doc: ProjectDocument,
    *,
    created_by: str | None,
    href: str | None = None,
    storage_key: str | None = None,
    mime_type: str | None = None,
    file_size: int | None = None,
    checksum_sha256: str | None = None,
    notes: str | None = None,
) -> DocumentVersion:
    current = await get_current_version(db, doc.id)
    next_number = (current.version_number + 1) if current else 1
    version = DocumentVersion(
        document_id=doc.id,
        version_number=next_number,
        storage_key=storage_key,
        mime_type=mime_type,
        file_size=file_size,
        checksum_sha256=checksum_sha256,
        href=href,
        notes=notes,
        created_by=created_by,
    )
    db.add(version)
    await db.flush()
    doc.current_version_id = version.id
    doc.status = DocumentStatus.active.value
    await db.flush()
    return version


async def sign_document(
    db: AsyncSession,
    doc: ProjectDocument,
    *,
    signer_user_id: str,
    signer_role: str,
    signature_type: str = "in_app",
    provider_name: str | None = None,
    provider_external_id: str | None = None,
    content_hash: str | None = None,
    status: str = "signed",
    signed_at: datetime | None = None,
) -> DocumentSignature:
    if not doc.current_version_id:
        raise ValueError("document_has_no_version")
    signature = DocumentSignature(
        document_id=doc.id,
        version_id=doc.current_version_id,
        signer_user_id=signer_user_id,
        signer_role=signer_role,
        signature_type=signature_type,
        provider_name=provider_name or signature_type,
        provider_external_id=provider_external_id,
        content_hash=content_hash,
        status=status,
        signed_at=signed_at or (utc_now() if status == "signed" else None),
    )
    db.add(signature)
    await db.flush()
    return signature
