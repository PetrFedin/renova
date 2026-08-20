"""Canonical local lifecycle for document signing and archiving."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    ProjectDocument,
)
from app.services import outbox_service as outbox
from app.services import project_document_service as documents


def _member_ids(project: Project) -> list[str]:
    return sorted(
        {
            user_id
            for user_id in (
                project.customer_id,
                project.contractor_id,
            )
            if user_id
        }
    )


async def _existing_signature(
    db: AsyncSession,
    *,
    document_id: str,
    version_id: str,
    signer_user_id: str,
    provider_name: str,
) -> DocumentSignature | None:
    query = select(DocumentSignature).where(
        DocumentSignature.document_id == document_id,
        DocumentSignature.version_id == version_id,
        DocumentSignature.signer_user_id == signer_user_id,
        DocumentSignature.provider_name == provider_name,
        DocumentSignature.status.in_(("pending", "signed")),
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    rows = list((await db.execute(query)).scalars().all())
    if not rows:
        return None
    return min(
        rows,
        key=lambda row: (0 if row.status == "signed" else 1, row.id),
    )


async def _prepare_signature(
    db: AsyncSession,
    *,
    document: ProjectDocument,
    actor: User,
    signature_type: str,
    content_hash: str | None,
    provider: str | None,
) -> tuple[DocumentSignature, bool]:
    version = await documents.get_current_version(db, document.id)
    if not version:
        raise ValueError("document_has_no_version")

    provider_name = (provider or signature_type or "in_app").strip().lower()
    existing = await _existing_signature(
        db,
        document_id=document.id,
        version_id=version.id,
        signer_user_id=actor.id,
        provider_name=provider_name,
    )
    if existing:
        return existing, True

    signature = await documents.sign_document(
        db,
        document,
        signer_user_id=actor.id,
        signer_role=getattr(actor.role, "value", str(actor.role)),
        signature_type=signature_type,
        content_hash=content_hash,
        provider=provider,
    )
    return signature, False


async def _enqueue_sign_effects(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
) -> None:
    role = getattr(actor.role, "value", str(actor.role))
    await outbox.enqueue(
        db,
        aggregate_type="project_document",
        aggregate_id=document.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor.id,
            "kind": "DocumentSigned",
            "title": f"Подписан документ: {document.title}",
            "body": role,
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
                "title": f"Документ подписан: {document.title}",
                "body": role,
                "link_path": "/documents",
                "return_to": (
                    "/(customer)/(tabs)/home"
                    if is_customer
                    else "/(contractor)/(tabs)/home"
                ),
            },
        )


async def sign_document(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
    signature_type: str,
    content_hash: str | None,
    provider: str | None,
) -> tuple[DocumentSignature, bool]:
    if document.status in {
        DocumentStatus.archived.value,
        DocumentStatus.deleted.value,
    }:
        raise ValueError("document_not_signable")

    try:
        signature, replayed = await _prepare_signature(
            db,
            document=document,
            actor=actor,
            signature_type=signature_type,
            content_hash=content_hash,
            provider=provider,
        )
        if replayed:
            return signature, True
        await _enqueue_sign_effects(
            db,
            project=project,
            document=document,
            actor=actor,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(signature)
    await db.refresh(document)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source="document.sign",
        limit=10,
    )
    return signature, False


async def _enqueue_archive_effects(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
) -> None:
    document_kind = document.document_type or "other"
    await outbox.enqueue(
        db,
        aggregate_type="project_document",
        aggregate_id=document.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor.id,
            "kind": "DocumentArchived",
            "title": f"В архив: {document.title}",
            "body": document_kind,
            "link_path": "/documents",
        },
    )
    if project.customer_id and project.customer_id != actor.id:
        await outbox.enqueue(
            db,
            aggregate_type="project_document",
            aggregate_id=document.id,
            event_type=outbox.NOTIFICATION_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project.id,
                "notification_type": "document",
                "title": f"Документ в архиве: {document.title}",
                "body": document_kind,
                "link_path": "/documents",
                "return_to": "/(customer)/(tabs)/home",
            },
        )


async def archive_document(
    db: AsyncSession,
    *,
    project: Project,
    document: ProjectDocument,
    actor: User,
) -> tuple[ProjectDocument, bool]:
    if document.status == DocumentStatus.archived.value:
        return document, True
    if document.status == DocumentStatus.deleted.value:
        raise ValueError("document_not_found")

    try:
        await documents.archive_document(db, document)
        await _enqueue_archive_effects(
            db,
            project=project,
            document=document,
            actor=actor,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(document)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source="document.archive",
        limit=10,
    )
    return document, False
