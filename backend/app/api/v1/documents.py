"""Document Center: index + canonical ProjectDocument API (D-01…D-07)."""
import hashlib
import json
from datetime import datetime
import mimetypes

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import AcceptanceStatus, DesignPackage, Receipt, Stage, User, WorkAcceptance
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.schemas.project_documents import DocumentCreateIn, DocumentSignIn, DocumentVersionIn, LegalHoldIn, OcrRunIn
from app.services import project_document_service as docs_svc
from app.services import notification_service as notif
from app.models.entities import Project
from app.services import storage_service as storage_svc

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
ALLOWED_UPLOAD_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
}

router = APIRouter(prefix="/projects", tags=["documents"])

async def require_project_docs(db: AsyncSession, project_id: str, user: User, *, write: bool = False):
    """D-07: чужой проект → 404 (не раскрываем существование)."""
    try:
        return await require_project(db, project_id, user, write=write)
    except HTTPException as e:
        if e.status_code in (403, 404):
            raise HTTPException(404, "document_or_project_not_found") from e
        raise



def export_doc(project_id: str, kind: str, title: str, href: str) -> dict:
    return {
        "id": f"export:{kind}",
        "source": "export",
        "kind": kind,
        "title": title,
        "status": "ready",
        "href": href,
        "created_at": None,
        "amount": None,
        "verified": None,
        "version": None,
        "meta": {"project_id": project_id},
    }


@router.get("/{project_id}/documents")
async def list_project_documents(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project_docs(db, project_id, user, write=False)
    docs: list[dict] = []

    # Canonical rows first
    canonical = await docs_svc.list_canonical_documents(db, project_id)
    docs.extend(canonical)
    canonical_acceptance_ids = {
        item.get("meta", {}).get("work_acceptance_id")
        for item in canonical
        if item.get("kind") == "acceptance_act"
    }

    design_rows = list(
        (
            await db.execute(
                select(DesignPackage)
                .where(DesignPackage.project_id == project_id)
                .order_by(DesignPackage.version.desc(), DesignPackage.created_at.desc())
            )
        ).scalars().all()
    )
    for item in design_rows:
        docs.append({
            "id": f"design:{item.id}",
            "source": "design",
            "kind": "design_package",
            "title": f"Дизайн v{item.version}: {item.title}",
            "status": item.status,
            "href": f"/api/v1/media/{item.file_key}" if item.file_key else None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "amount": None,
            "verified": None,
            "version": item.version,
            "meta": {"notes": item.notes, "file_key": item.file_key},
        })

    acceptance_rows = list(
        (
            await db.execute(
                select(WorkAcceptance, Stage)
                .join(Stage, Stage.id == WorkAcceptance.stage_id)
                .where(WorkAcceptance.project_id == project_id)
                .where(WorkAcceptance.status.in_([
                    AcceptanceStatus.accepted.value,
                    AcceptanceStatus.accepted_with_remarks.value,
                ]))
                .order_by(WorkAcceptance.accepted_at.desc(), WorkAcceptance.created_at.desc())
            )
        ).all()
    )
    for acceptance, stage in acceptance_rows:
        # Prefer canonical acceptance_act when present
        if acceptance.id in canonical_acceptance_ids:
            continue
        docs.append({
            "id": f"acceptance:{acceptance.id}",
            "source": "acceptance",
            "kind": "stage_acceptance_act",
            "title": f"Акт приёмки: {stage.name}",
            "status": acceptance.status,
            "href": f"/api/v1/projects/{project_id}/stages/{stage.id}/acceptance.pdf",
            "created_at": (
                acceptance.accepted_at.isoformat()
                if acceptance.accepted_at
                else acceptance.created_at.isoformat() if acceptance.created_at else None
            ),
            "amount": None,
            "verified": None,
            "version": None,
            "meta": {
                "quality_score": acceptance.quality_score,
                "comment": acceptance.comment,
                "accepted_by": acceptance.accepted_by,
                "stage_id": stage.id,
                "work_acceptance_id": acceptance.id,
            },
        })

    receipt_rows = list(
        (
            await db.execute(
                select(Receipt)
                .where(Receipt.project_id == project_id)
                .order_by(Receipt.created_at.desc())
            )
        ).scalars().all()
    )
    for item in receipt_rows:
        title = item.qr_raw if item.fn == "MANUAL" and item.qr_raw else "Фискальный чек"
        docs.append({
            "id": f"receipt:{item.id}",
            "source": "receipt",
            "kind": "receipt",
            "title": title[:80],
            "status": "verified" if item.fns_verified else "unverified",
            "href": None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "amount": item.amount,
            "verified": item.fns_verified,
            "version": None,
            "meta": {
                "category": item.expense_category,
                "room_id": item.room_id,
                "stage_id": item.stage_id,
                "payment_id": item.payment_id,
                "source": "manual" if item.fn == "MANUAL" else "scan",
            },
        })

    docs.extend([
        export_doc(project_id, "project_pdf", "Полный отчёт проекта", f"/api/v1/projects/{project_id}/export.pdf"),
        export_doc(project_id, "full_dossier_pdf", "Полное досье проекта", f"/api/v1/projects/{project_id}/full-dossier.pdf"),
        export_doc(project_id, "activity_dossier_pdf", "Досье событий", f"/api/v1/projects/{project_id}/activity-dossier.pdf"),
        export_doc(project_id, "estimate_pdf", "Смета PDF", f"/api/v1/projects/{project_id}/estimate.pdf"),
        export_doc(project_id, "estimate_csv", "Смета CSV", f"/api/v1/projects/{project_id}/estimate.csv"),
        export_doc(project_id, "estimate_xlsx", "Смета Excel", f"/api/v1/projects/{project_id}/estimate.xlsx"),
        export_doc(project_id, "kpi_weekly_pdf", "Еженедельный KPI-отчёт", f"/api/v1/projects/{project_id}/kpi-weekly.pdf"),
    ])

    docs.sort(
        key=lambda item: (
            item.get("created_at") is not None,
            item.get("created_at") or "",
        ),
        reverse=True,
    )
    return {
        "project_id": project_id,
        "project_name": project.name,
        "items": docs,
        "counts": {
            "total": len(docs),
            "canonical": len([item for item in docs if item["source"] == "canonical"]),
            "design": len([item for item in docs if item["source"] == "design"]),
            "acceptances": len([
                item for item in docs
                if item["source"] in ("acceptance", "canonical") and item.get("kind") in ("acceptance_act", "stage_acceptance_act")
            ]),
            "receipts": len([item for item in docs if item["source"] == "receipt"]),
            "exports": len([item for item in docs if item["source"] == "export"]),
        },
    }


async def _get_project_document(db: AsyncSession, project_id: str, document_id: str) -> ProjectDocument:
    doc = await db.get(ProjectDocument, document_id)
    if not doc or doc.project_id != project_id or doc.status == DocumentStatus.deleted.value:
        raise HTTPException(404, "document_not_found")
    return doc


@router.post("/{project_id}/documents")
async def create_project_document(
    project_id: str,
    body: DocumentCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    doc = await docs_svc.create_document(
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
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)


@router.post("/{project_id}/documents/{document_id}/versions")
async def add_document_version(
    project_id: str,
    document_id: str,
    body: DocumentVersionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    version = await docs_svc.add_version(
        db,
        doc,
        created_by=user.id,
        href=body.href,
        storage_key=body.storage_key,
        mime_type=body.mime_type,
        file_size=body.file_size,
        checksum_sha256=body.checksum_sha256,
        notes=body.notes,
    )
    await db.commit()
    return docs_svc.document_dict(doc, version)


@router.post("/{project_id}/documents/{document_id}/sign")
async def sign_project_document(
    project_id: str,
    document_id: str,
    body: DocumentSignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    try:
        sig = await docs_svc.sign_document(
            db,
            doc,
            signer_user_id=user.id,
            signer_role=getattr(user.role, "value", str(user.role)),
            signature_type=body.signature_type,
            content_hash=body.content_hash,
            provider=body.provider,
        )
    except ValueError as e:
        msg = str(e)
        if msg.startswith("provider_unavailable:"):
            raise HTTPException(501, msg) from e
        if msg.startswith("unknown_esign_provider:"):
            raise HTTPException(400, msg) from e
        raise HTTPException(400, msg) from e
    from app.services import activity_service as act

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="DocumentSigned",
        title=f"Подписан документ: {doc.title}",
        body=getattr(user.role, "value", str(user.role)),
        link_path="/documents",
    )
    proj = await db.get(Project, project_id)
    if proj:
        for recipient_id in {proj.customer_id, proj.contractor_id, proj.foreman_id}:
            if not recipient_id or recipient_id == user.id:
                continue
            await notif.notify(
                db,
                user_id=recipient_id,
                project_id=project_id,
                notification_type="document",
                title=f"Документ подписан: {doc.title}",
                body=getattr(user.role, "value", str(user.role)),
                link_path="/documents",
                return_to="/(customer)/(tabs)/home" if recipient_id == proj.customer_id else "/(contractor)/(tabs)/home",
            )
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    meta = {}
    if getattr(sig, "meta_json", None):
        try:
            meta = json.loads(sig.meta_json)
        except Exception:
            meta = {}
    return {
        "signature_id": sig.id,
        "status": sig.status,
        "external_id": sig.provider_external_id,
        "signing_url": meta.get("signing_url"),
        "provider": sig.provider_name or sig.signature_type,
        "document": docs_svc.document_dict(doc, version, [sig]),
    }


@router.post("/{project_id}/documents/{document_id}/archive")
async def archive_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    await docs_svc.archive_document(db, doc)
    from app.services import activity_service as act

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="DocumentArchived",
        title=f"В архив: {doc.title}",
        body=doc.document_type or doc.kind,
        link_path="/documents",
    )
    proj = await db.get(Project, project_id)
    if proj and proj.customer_id and proj.customer_id != user.id:
        await notif.notify(
            db,
            user_id=proj.customer_id,
            project_id=project_id,
            notification_type="document",
            title=f"Документ в архиве: {doc.title}",
            body=doc.document_type or doc.kind or "",
            link_path="/documents",
            return_to="/(customer)/(tabs)/home",
        )
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)


@router.post("/{project_id}/documents/upload")
async def upload_project_document(
    project_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    document_type: str = Form(DocumentType.upload.value),
    stage_id: str | None = Form(None),
    payment_id: str | None = Form(None),
    notes: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """D-06: multipart upload → storage + ProjectDocument + DocumentVersion."""
    await require_project_docs(db, project_id, user, write=True)

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty_file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file_too_large")

    content_type = (file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream")
    if content_type not in ALLOWED_UPLOAD_TYPES and not content_type.startswith("image/"):
        # allow unknown but safe binary as octet-stream
        content_type = "application/octet-stream"

    checksum = hashlib.sha256(data).hexdigest()
    storage_key, href = await storage_svc.save_bytes(
        data,
        folder=f"documents/{project_id}",
        filename=file.filename,
        content_type=content_type,
    )

    doc_title = (title or file.filename or "Загруженный документ").strip()[:255]
    doc = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user.id,
        title=doc_title,
        document_type=document_type or DocumentType.upload.value,
        stage_id=stage_id,
        payment_id=payment_id,
        notes=notes,
        href=href,
        storage_key=storage_key,
        mime_type=content_type,
        file_size=len(data),
        checksum_sha256=checksum,
    )
    # Wave 3b/3c: OCR — sync classify in-request или async enqueue для worker
    from app.core.config import settings as app_settings
    from app.services import document_ocr_service as ocr_svc
    version = await docs_svc.get_current_version(db, doc.id)
    if version:
        mode = (app_settings.document_ocr_mode or "sync").strip().lower()
        if mode == "async":
            await ocr_svc.enqueue_ocr(db, version)
        else:
            await ocr_svc.enqueue_and_run(db, doc, version, apply_type=True)
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)


@router.post("/{project_id}/documents/{document_id}/restore")
async def restore_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """D-04: restore archived → active."""
    await require_project_docs(db, project_id, user, write=True)
    doc = await db.get(ProjectDocument, document_id)
    if not doc or doc.project_id != project_id:
        raise HTTPException(404, "document_or_project_not_found")
    try:
        await docs_svc.restore_document(db, doc)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)


@router.delete("/{project_id}/documents/{document_id}")
async def delete_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """D-04: soft-delete. Signed documents cannot be deleted (archive instead)."""
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    try:
        await docs_svc.soft_delete_document(db, doc)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    await db.commit()
    return {"ok": True, "id": document_id, "status": "deleted"}


@router.post("/{project_id}/documents/{document_id}/legal-hold")
async def set_document_legal_hold(
    project_id: str,
    document_id: str,
    body: LegalHoldIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Wave 3: legal hold блокирует soft-delete до снятия."""
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    retention = None
    if body.retention_until:
        try:
            retention = datetime.fromisoformat(body.retention_until.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as e:
            raise HTTPException(400, "invalid_retention_until") from e
    await docs_svc.set_legal_hold(db, doc, enabled=body.enabled, retention_until=retention)
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)


@router.get("/{project_id}/documents/{document_id}/ocr")
async def get_document_ocr(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Wave 3b: статус OCR classify для текущей версии."""
    await require_project_docs(db, project_id, user, write=False)
    doc = await _get_project_document(db, project_id, document_id)
    version = await docs_svc.get_current_version(db, doc.id)
    from app.services.document_ocr_service import ocr_dict

    return {"document_id": doc.id, "document_type": doc.document_type, "ocr": ocr_dict(version)}


@router.post("/{project_id}/documents/{document_id}/ocr")
async def run_document_ocr(
    project_id: str,
    document_id: str,
    body: OcrRunIn = OcrRunIn(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Перезапуск OCR stub (sync). apply_type обновляет kind при высокой уверенности."""
    await require_project_docs(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    version = await docs_svc.get_current_version(db, doc.id)
    if not version:
        raise HTTPException(400, "document_has_no_version")
    from app.services import document_ocr_service as ocr_svc

    await ocr_svc.enqueue_and_run(db, doc, version, apply_type=body.apply_type)
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)
