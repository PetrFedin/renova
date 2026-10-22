"""W74: регистрация выгрузок (1С/банк) в Document Center — след в golden path documents."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_documents import (
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)


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
    """Фиксирует выгрузку в Document Center: новая версия, а не новый документ.

    Выгрузка — это ссылка на ручку, а не файл: `href` у неё один и тот же при
    каждом скачивании. Раньше каждое скачивание создавало новую запись
    документа, и Центр документов рос без предела — заказчик, четырежды
    скачавший реестр для банка, видел четыре одинаковые карточки «Действует ·
    v1». Механизм версий для этого уже есть, им и пользуемся: повторное
    скачивание поднимает версию существующего документа.
    """
    from app.services import project_document_service as docs_svc
    from app.services import activity_service as act

    doc = await _existing_export_document(db, project_id=project_id, href=href)
    if doc is not None:
        await docs_svc.add_version(
            db,
            doc,
            created_by=user_id,
            href=href,
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


async def _existing_export_document(
    db: AsyncSession,
    *,
    project_id: str,
    href: str,
) -> ProjectDocument | None:
    """Ранее зарегистрированная выгрузка этого же проекта по тому же адресу.

    Сверяем по `href` текущей версии, а не по заголовку: заголовок может быть
    переименован, адрес ручки — это и есть тождество выгрузки. Удалённые
    документы пропускаем: их повторное скачивание должно заводить новый
    документ, а не воскрешать выброшенный.
    """
    return (
        await db.execute(
            select(ProjectDocument)
            .join(DocumentVersion, DocumentVersion.id == ProjectDocument.current_version_id)
            .where(ProjectDocument.project_id == project_id)
            .where(ProjectDocument.status != DocumentStatus.deleted.value)
            .where(DocumentVersion.href == href)
            .order_by(ProjectDocument.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
