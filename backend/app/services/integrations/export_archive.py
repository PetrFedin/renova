"""W74: регистрация выгрузок (1С/банк) в Document Center — след в golden path documents."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import DocumentType


async def register_export_in_documents(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    href: str,
    notes: str | None = None,
    document_type: str | None = None,
) -> str:
    """Создаёт запись документа со ссылкой на API-выгрузку (не дублирует blob)."""
    from app.services import project_document_service as docs_svc
    from app.services import activity_service as act

    doc = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user_id,
        document_type=document_type or DocumentType.other.value,
        title=title[:200],
        notes=(notes or "")[:2000],
        href=href,
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
