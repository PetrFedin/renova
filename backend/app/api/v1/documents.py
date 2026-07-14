"""Document Center: index + canonical ProjectDocument API (D-01…D-07)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import AcceptanceStatus, DesignPackage, Receipt, Stage, User, WorkAcceptance
from app.models.project_documents import DocumentStatus, ProjectDocument
from app.schemas.project_documents import DocumentCreateIn, DocumentSignIn, DocumentVersionIn
from app.services import project_document_service as docs_svc

router = APIRouter(prefix="/projects", tags=["documents"])


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
    project = await require_project(db, project_id, user, write=False)
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
    await require_project(db, project_id, user, write=True)
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
    await require_project(db, project_id, user, write=True)
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
    await require_project(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    try:
        sig = await docs_svc.sign_document(
            db,
            doc,
            signer_user_id=user.id,
            signer_role=getattr(user.role, "value", str(user.role)),
            signature_type=body.signature_type,
            content_hash=body.content_hash,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return {"signature_id": sig.id, "document": docs_svc.document_dict(doc, version, [sig])}


@router.post("/{project_id}/documents/{document_id}/archive")
async def archive_project_document(
    project_id: str,
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    doc = await _get_project_document(db, project_id, document_id)
    await docs_svc.archive_document(db, doc)
    await db.commit()
    version = await docs_svc.get_current_version(db, doc.id)
    return docs_svc.document_dict(doc, version)
