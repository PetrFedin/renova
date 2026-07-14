"""Service layer for ProjectDocument lifecycle (D-01…D-07)."""
from __future__ import annotations

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
            "work_acceptance_id": doc.work_acceptance_id,
            "current_version_id": doc.current_version_id,
            "notes": doc.notes,
            "signatures": [
                {
                    "id": s.id,
                    "signer_user_id": s.signer_user_id,
                    "signer_role": s.signer_role,
                    "signed_at": s.signed_at.isoformat() if s.signed_at else None,
                    "status": s.status,
                }
                for s in (signatures or [])
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
        sigs = list(
            (
                await db.execute(
                    select(DocumentSignature).where(DocumentSignature.document_id == doc.id)
                )
            ).scalars().all()
        )
        result.append(document_dict(doc, version, sigs))
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
    if current:
        # mark doc active; previous versions stay for history
        pass
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
    content_hash: str | None = None,
) -> DocumentSignature:
    version = await get_current_version(db, doc.id)
    if not version:
        raise ValueError("document_has_no_version")
    sig = DocumentSignature(
        document_id=doc.id,
        version_id=version.id,
        signer_user_id=signer_user_id,
        signer_role=signer_role,
        signature_type=signature_type,
        content_hash=content_hash or version.checksum_sha256,
        status="signed",
        signed_at=datetime.utcnow(),
    )
    db.add(sig)
    await db.flush()
    return sig


async def archive_document(db: AsyncSession, doc: ProjectDocument) -> ProjectDocument:
    doc.status = DocumentStatus.archived.value
    doc.archived_at = datetime.utcnow()
    await db.flush()
    return doc


async def ensure_acceptance_act_document(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    stage_name: str,
    acceptance_id: str,
    accepted_by: str | None,
) -> ProjectDocument:
    """Idempotent: один canonical акт на work_acceptance."""
    existing = (
        await db.execute(
            select(ProjectDocument)
            .where(ProjectDocument.project_id == project_id)
            .where(ProjectDocument.work_acceptance_id == acceptance_id)
            .where(ProjectDocument.document_type == DocumentType.acceptance_act.value)
        )
    ).scalar_one_or_none()
    href = f"/api/v1/projects/{project_id}/stages/{stage_id}/acceptance.pdf"
    if existing:
        version = await get_current_version(db, existing.id)
        if version and not version.href:
            version.href = href
        return existing

    return await create_document(
        db,
        project_id=project_id,
        created_by=accepted_by,
        title=f"Акт приёмки: {stage_name}",
        document_type=DocumentType.acceptance_act.value,
        stage_id=stage_id,
        work_acceptance_id=acceptance_id,
        href=href,
        mime_type="application/pdf",
        notes="auto-created on work acceptance",
    )
