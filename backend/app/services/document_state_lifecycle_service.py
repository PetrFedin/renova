"""Atomic restore, delete and legal-hold transitions for project documents."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User
from app.models.project_documents import DocumentStatus, ProjectDocument
from app.services import outbox_service as outbox
from app.services import project_document_service as documents


def _member_ids(project: Project) -> list[str]:
    return sorted(
        {
            user_id
            for user_id in (
                project.customer_id,
                project.contractor_id,
                project.foreman_id,
            )
            if user_id
        }
    )


async def _prepare_effects(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
    kind: str,
    title: str,
    body: str,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="project_document",
        aggregate_id=document.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor.id,
            "kind": kind,
            "title": title,
            "body": body,
            "link_path": "/documents",
        },
    )
    for recipient_id in _member_ids(project):
        if recipient_id == actor.id:
            continue
        is_customer = recipient_id == project.customer_id
        await outbox.enqueue(
            db,
            aggregate_type="project_document",
            aggregate_id=document.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": recipient_id,
                "project_id": project.id,
                "notification_type": "document",
                "title": title,
                "body": body,
                "link_path": "/documents",
                "return_to": (
                    "/(customer)/(tabs)/home"
                    if is_customer
                    else "/(contractor)/(tabs)/home"
                ),
            },
        )


async def _commit_and_dispatch(
    db: AsyncSession,
    *,
    document: ProjectDocument,
    source: str,
) -> ProjectDocument:
    await db.commit()
    await db.refresh(document)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)
    return document


async def restore_document(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
) -> tuple[ProjectDocument, bool]:
    if document.status == DocumentStatus.active.value:
        return document, True
    if document.status == DocumentStatus.deleted.value:
        raise ValueError("cannot_restore_deleted")
    if document.status != DocumentStatus.archived.value:
        raise ValueError("document_not_archived")

    try:
        await documents.restore_document(db, document)
        await _prepare_effects(
            db,
            project=project,
            document=document,
            actor=actor,
            kind="DocumentRestored",
            title=f"Документ восстановлен: {document.title}",
            body=document.document_type or "other",
        )
        await _commit_and_dispatch(
            db,
            document=document,
            source="document.restore",
        )
    except BaseException:
        await db.rollback()
        raise
    return document, False


async def delete_document(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
) -> tuple[ProjectDocument, bool]:
    if document.status == DocumentStatus.deleted.value:
        return document, True

    try:
        await documents.soft_delete_document(db, document)
        await _prepare_effects(
            db,
            project=project,
            document=document,
            actor=actor,
            kind="DocumentDeleted",
            title=f"Документ удалён: {document.title}",
            body=document.document_type or "other",
        )
        await _commit_and_dispatch(
            db,
            document=document,
            source="document.delete",
        )
    except ValueError:
        # Guard failures (legal hold / existing signature) happen before mutation.
        # Keep the caller's loaded identity map usable and return the domain error.
        raise
    except BaseException:
        await db.rollback()
        raise
    return document, False


def _same_retention(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return left is right
    return left.replace(tzinfo=None) == right.replace(tzinfo=None)


async def set_legal_hold(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
    enabled: bool,
    retention_until: datetime | None,
) -> tuple[ProjectDocument, bool]:
    if document.status == DocumentStatus.deleted.value:
        raise ValueError("deleted_document_cannot_change_legal_hold")
    effective_retention = retention_until if enabled else None
    if bool(document.legal_hold) == enabled and _same_retention(
        document.retention_until,
        effective_retention,
    ):
        return document, True

    try:
        await documents.set_legal_hold(
            db,
            document,
            enabled=enabled,
            retention_until=effective_retention,
        )
        action = "установлен" if enabled else "снят"
        await _prepare_effects(
            db,
            project=project,
            document=document,
            actor=actor,
            kind=(
                "DocumentLegalHoldEnabled"
                if enabled
                else "DocumentLegalHoldDisabled"
            ),
            title=f"Legal hold {action}: {document.title}",
            body=(
                effective_retention.isoformat()
                if effective_retention
                else "без срока"
            ),
        )
        await _commit_and_dispatch(
            db,
            document=document,
            source="document.legal_hold",
        )
    except BaseException:
        await db.rollback()
        raise
    return document, False
