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
            "work_acceptance_id": doc.work_acceptance_id,
            "current_version_id": doc.current_version_id,
            "notes": doc.notes,
            "legal_hold": bool(getattr(doc, "legal_hold", False)),
            "retention_until": doc.retention_until.isoformat() if getattr(doc, "retention_until", None) else None,
            "ocr": ocr_dict(version),
            "signatures": [
                {
                    "id": s.id,
                    "signer_user_id": s.signer_user_id,
                    "signer_role": s.signer_role,
                    "signed_at": s.signed_at.isoformat() if s.signed_at else None,
                    "status": s.status,
                    "provider": getattr(s, "provider_name", None) or s.signature_type,
                    "provider_name": getattr(s, "provider_name", None) or s.signature_type,
                    "signature_type": s.signature_type,
                    "provider_external_id": getattr(s, "provider_external_id", None),
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
    provider: str | None = None,
) -> DocumentSignature:
    """Подпись через e-sign registry (in_app сегодня; внешние → unavailable)."""
    import json

    from app.services.esign.base import SignRequest
    from app.services.esign.registry import get_provider

    version = await get_current_version(db, doc.id)
    if not version:
        raise ValueError("document_has_no_version")

    provider_name = provider or signature_type or "in_app"
    try:
        esign = get_provider(provider_name)
    except KeyError as e:
        raise ValueError(str(e)) from e

    if not esign.is_available():
        raise ValueError(f"provider_unavailable:{esign.name}")

    result = await esign.create_signature(
        SignRequest(
            document_id=doc.id,
            version_id=version.id,
            signer_user_id=signer_user_id,
            signer_role=signer_role,
            content_hash=content_hash or version.checksum_sha256,
            title=doc.title,
            mime_type=version.mime_type,
        )
    )
    if result.status not in ("signed", "pending"):
        raise ValueError(result.error or f"sign_failed:{result.status}")

    sig = DocumentSignature(
        document_id=doc.id,
        version_id=version.id,
        signer_user_id=signer_user_id,
        signer_role=signer_role,
        signature_type=result.signature_type or signature_type,
        provider_name=result.provider_name,
        provider_external_id=result.external_id,
        content_hash=content_hash or version.checksum_sha256,
        status=result.status,  # signed | pending (Wave 3f external)
        signed_at=datetime.utcnow() if result.status == "signed" else None,
        meta_json=json.dumps(result.meta, ensure_ascii=False) if result.meta else None,
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


async def restore_document(db: AsyncSession, doc: ProjectDocument) -> ProjectDocument:
    """D-04: restore from archived (not from deleted)."""
    if doc.status == DocumentStatus.deleted.value:
        raise ValueError("cannot_restore_deleted")
    if doc.status != DocumentStatus.archived.value:
        raise ValueError("document_not_archived")
    doc.status = DocumentStatus.active.value
    doc.archived_at = None
    await db.flush()
    return doc


async def document_has_signatures(db: AsyncSession, document_id: str) -> bool:
    row = (
        await db.execute(
            select(DocumentSignature.id).where(DocumentSignature.document_id == document_id).limit(1)
        )
    ).first()
    return row is not None


async def soft_delete_document(db: AsyncSession, doc: ProjectDocument) -> ProjectDocument:
    """D-04: soft delete. Signed / legal-hold docs cannot be destroyed."""
    if getattr(doc, "legal_hold", False):
        raise ValueError("legal_hold_blocks_delete")
    if await document_has_signatures(db, doc.id):
        raise ValueError("signed_document_cannot_be_deleted")
    doc.status = DocumentStatus.deleted.value
    doc.archived_at = datetime.utcnow()
    await db.flush()
    return doc


async def set_legal_hold(
    db: AsyncSession,
    doc: ProjectDocument,
    *,
    enabled: bool,
    retention_until: datetime | None = None,
) -> ProjectDocument:
    """Wave 3: legal hold — блок soft-delete до снятия холда."""
    doc.legal_hold = enabled
    if enabled:
        doc.retention_until = retention_until
    else:
        doc.retention_until = None
    await db.flush()
    return doc






async def ensure_contract_draft(db: AsyncSession, *, project_id: str, created_by: str | None) -> dict:
    """P3-W10: создать draft contract если есть неподписанный договор или его нет."""
    from app.models.project_documents import DocumentType

    gate = await project_contract_gate(db, project_id)
    if gate.get("ok") and gate.get("reason") != "no_contract_required":
        return {"created": False, "document_id": gate.get("document_id"), "pending_titles": []}
    contracts = list(
        (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project_id,
                    ProjectDocument.document_type == DocumentType.contract.value,
                    ProjectDocument.status != DocumentStatus.deleted.value,
                )
            )
        ).scalars().all()
    )
    pending = [d for d in contracts if d.status == DocumentStatus.draft.value]
    if pending:
        return {"created": False, "document_id": pending[0].id, "pending_titles": [d.title for d in pending[:3]]}
    if contracts and not pending:
        return {"created": False, "document_id": contracts[0].id, "pending_titles": [contracts[0].title]}
    doc = await create_document(
        db,
        project_id=project_id,
        created_by=created_by,
        title="Договор подряда",
        document_type=DocumentType.contract.value,
        notes="Создан автоматически при фиксации сметы",
    )
    doc.status = DocumentStatus.draft.value
    await db.flush()
    return {"created": True, "document_id": doc.id, "pending_titles": [doc.title]}


async def project_contract_gate(db: AsyncSession, project_id: str) -> dict:
    """P3-W7: estimate → eSign → work unlock — блок start_stage без подписанного договора."""
    from app.models.project_documents import DocumentType

    contracts = list(
        (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project_id,
                    ProjectDocument.document_type == DocumentType.contract.value,
                    ProjectDocument.status != DocumentStatus.deleted.value,
                )
            )
        ).scalars().all()
    )
    if not contracts:
        return {"ok": True, "reason": "no_contract_required"}
    for doc in contracts:
        sigs = list(
            (
                await db.execute(
                    select(DocumentSignature).where(
                        DocumentSignature.document_id == doc.id,
                        DocumentSignature.status == "signed",
                    )
                )
            ).scalars().all()
        )
        if sigs:
            return {"ok": True, "document_id": doc.id}
    pending = [d.title for d in contracts if d.status == DocumentStatus.draft.value]
    return {
        "ok": False,
        "code": "contract_not_signed",
        "message": "Подпишите договор перед началом работ",
        "pending_titles": pending[:3],
    }

async def complete_external_signature(
    db: AsyncSession,
    *,
    provider_name: str,
    external_id: str,
    status: str = "signed",
) -> DocumentSignature | None:
    """Wave 3f: webhook завершает pending подпись внешнего провайдера + activate doc."""
    row = (
        await db.execute(
            select(DocumentSignature).where(
                DocumentSignature.provider_name == provider_name,
                DocumentSignature.provider_external_id == external_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return None
    if status == "signed" and row.status == "signed" and row.signed_at:
        return row
    row.status = status
    if status == "signed" and not row.signed_at:
        row.signed_at = datetime.utcnow()
        doc = await db.get(ProjectDocument, row.document_id)
        if doc and doc.status == DocumentStatus.draft.value:
            doc.status = DocumentStatus.active.value
    elif status == "failed" and not row.revoked_at:
        row.revoked_at = datetime.utcnow()
    await db.flush()
    return row
