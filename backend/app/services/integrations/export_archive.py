"""W74: регистрация выгрузок (1С/банк) в Document Center — след в golden path documents."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentStatus, DocumentType, DocumentVersion, ProjectDocument


async def register_export_in_documents(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    href: str,
    notes: str | None = None,
    document_type: str | None = None,
    checksum_sha256: str | None = None,
) -> str:
    """Register one stable export artifact and version it only when bytes change."""
    from app.services import project_document_service as docs_svc
    from app.services import activity_service as act

    existing = (
        await db.execute(
            select(ProjectDocument, DocumentVersion)
            .join(
                DocumentVersion,
                ProjectDocument.current_version_id == DocumentVersion.id,
            )
            .where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.status != DocumentStatus.deleted.value,
                DocumentVersion.href == href,
            )
            .order_by(ProjectDocument.created_at.asc(), ProjectDocument.id.asc())
            .limit(1)
        )
    ).first()
    if existing:
        doc, version = existing
        if checksum_sha256 is None or version.checksum_sha256 == checksum_sha256:
            return doc.id
        await docs_svc.add_version(
            db,
            doc,
            created_by=user_id,
            href=href,
            checksum_sha256=checksum_sha256,
            notes=(notes or "")[:2000],
        )
    else:
        doc = await docs_svc.create_document(
            db,
            project_id=project_id,
            created_by=user_id,
            document_type=document_type or DocumentType.other.value,
            title=title[:200],
            notes=(notes or "")[:2000],
            href=href,
            checksum_sha256=checksum_sha256,
        )
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user_id,
        kind="ExportArchived",
        title=title[:200],
        body=notes,
        link_path="/documents",
    )
    await db.commit()
    return doc.id
