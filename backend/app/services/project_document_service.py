"""Service layer for ProjectDocument lifecycle (D-01…D-07)."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)


def document_dict(
    doc: ProjectDocument,
    version: DocumentVersion | None = None,
    signatures: list[DocumentSignature] | None = None,
) -> dict:
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
            "retention_until": doc.retention_until.isoformat()
            if getattr(doc, "retention_until", None)
            else None,
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



#: Типы документов, подписываемых сторонами договора. Подпись такого документа
#: допустима только от заказчика проекта или исполнителя-лида (см. `sign_document`).
PARTY_SIGNED_TYPES = frozenset({DocumentType.contract.value, DocumentType.addendum.value})

#: Пользовательский ввод не может создавать эти типы: основной договор рождается
#: только из зафиксированной сметы (`ensure_contract_draft`), документ допработ —
#: только из change order.
SYSTEM_ONLY_DOCUMENT_TYPES = frozenset({DocumentType.contract.value, DocumentType.addendum.value})


def is_main_contract(doc: ProjectDocument) -> bool:
    """Основной договор подряда: тип contract и не документ допработ.

    Клиент не может создать документ такого типа (см. SYSTEM_ONLY_DOCUMENT_TYPES),
    поэтому любой contract без change_order_id создан системой.
    """
    return doc.document_type == DocumentType.contract.value and not doc.change_order_id


def signature_party(project: Project, user_id: str | None) -> str | None:
    """Сторона подписи определяется по пользователю проекта, а не по роли в токене."""
    if user_id and user_id == project.customer_id:
        return "customer"
    if user_id and project.contractor_id and user_id == project.contractor_id:
        return "contractor"
    return None


def required_parties(project: Project) -> set[str]:
    return {"customer", "contractor"} if project.contractor_id else {"customer"}


async def signed_parties(db: AsyncSession, doc: ProjectDocument, project: Project) -> set[str]:
    """Стороны, подписавшие ТЕКУЩУЮ версию документа (подписи прежних версий не считаются)."""
    if not doc.current_version_id:
        return set()
    rows = list(
        (
            await db.execute(
                select(DocumentSignature).where(
                    DocumentSignature.document_id == doc.id,
                    DocumentSignature.version_id == doc.current_version_id,
                    DocumentSignature.status == "signed",
                )
            )
        ).scalars().all()
    )
    parties = {signature_party(project, row.signer_user_id) for row in rows}
    parties.discard(None)
    return parties  # type: ignore[return-value]


async def _has_live_signatures(db: AsyncSession, document_id: str) -> bool:
    """Есть подпись, которую новая версия обесценила бы (не отозванная и не провалившаяся)."""
    row = (
        await db.execute(
            select(DocumentSignature.id)
            .where(
                DocumentSignature.document_id == document_id,
                DocumentSignature.status.in_(("submitting", "pending", "signed")),
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def _activate_if_fully_signed(db: AsyncSession, doc: ProjectDocument) -> None:
    """draft -> active. У договора сторон — только когда подписали все обязательные стороны."""
    if doc.status != DocumentStatus.draft.value:
        return
    if doc.document_type in PARTY_SIGNED_TYPES:
        project = await db.get(Project, doc.project_id)
        if project is None or not (required_parties(project) <= await signed_parties(db, doc, project)):
            return
    doc.status = DocumentStatus.active.value
    await db.flush()


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
    if doc.document_type in PARTY_SIGNED_TYPES and await _has_live_signatures(db, doc.id):
        # Подписанный договор неизменяем: новая версия под теми же подписями
        # подменяла бы то, что стороны подписали. Нужна новая редакция — это
        # отдельное решение сторон, а не тихая подмена ссылки.
        raise ValueError("signed_document_version_locked")
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
    if doc.document_type not in PARTY_SIGNED_TYPES:
        doc.status = DocumentStatus.active.value
    await db.flush()
    return version


def _version_has_content(version: DocumentVersion) -> bool:
    """У версии есть на что смотреть: ссылка, файл или контрольная сумма.

    Контрольная сумма означает, что за версией стоят настоящие байты, даже
    если само хранилище адресуется иначе.
    """
    return bool(version.href or version.storage_key or version.checksum_sha256)


async def _freeze_contract_snapshot(db: AsyncSession, doc: ProjectDocument, version: DocumentVersion) -> str | None:
    """Снять снимок условий договора, если он ещё «живой»; вернуть хэш снимка.

    Пока у версии нет подписей, снимок пересобирается по текущей смете (нечего
    ещё защищать). После первой подписи он неизменен: вторая сторона подписывает
    ровно тот же текст и тот же хэш.
    """
    from app.services import contract_document_service as contract_svc

    if version.content_snapshot and await _has_live_signatures(db, doc.id):
        return contract_svc.snapshot_hash(version.content_snapshot)
    if version.checksum_sha256 and not version.content_snapshot:
        # За версией уже стоят настоящие байты со своей контрольной суммой
        # (файл, а не «живой» договор из сметы): фиксировать нечего.
        return None
    terms = await contract_svc.collect_terms(db, doc.project_id)
    if terms is None:
        # Проекта нет — фиксировать нечего, подпись идёт как раньше.
        return None
    snapshot = contract_svc.snapshot_json(terms)
    digest = contract_svc.snapshot_hash(snapshot)
    version.content_snapshot = snapshot
    version.checksum_sha256 = digest
    version.mime_type = version.mime_type or "application/pdf"
    await db.flush()
    return digest


async def frozen_contract_snapshot(db: AsyncSession, project_id: str) -> str | None:
    """Снимок основного договора, если он подписан или подписание начато."""
    for doc in await _main_contracts(db, project_id):
        if not doc.current_version_id:
            continue
        version = await db.get(DocumentVersion, doc.current_version_id)
        if version and version.content_snapshot and await _has_live_signatures(db, doc.id):
            return version.content_snapshot
    return None


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
    """Create one canonical signature request for a signer/version/provider.

    External providers are called only after a durable `submitting` signature and
    outbox event have committed. Inline dispatch preserves the current fast path;
    the background worker reconciles any interrupted provider/local commit window.
    """
    import json

    from app.models.entities import DomainOutbox
    from app.services import outbox_service as outbox
    from app.services.esign.base import SignRequest, signature_idempotency_key
    from app.services.esign.registry import get_provider
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    async def raise_inline_submission_error(signature: DocumentSignature) -> None:
        if signature.status != "submitting":
            return
        # Read the scalar database value instead of an ORM row that may still be
        # present in the identity map from before the worker's failure commit.
        last_error = (
            await db.execute(
                select(DomainOutbox.last_error)
                .where(
                    DomainOutbox.aggregate_type == "document_signature",
                    DomainOutbox.aggregate_id == signature.id,
                    DomainOutbox.event_type == outbox.ESIGN_SUBMISSION_EVENT,
                )
                .order_by(DomainOutbox.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if last_error:
            raise ValueError(str(last_error))

    version = await get_current_version(db, doc.id)
    if not version:
        raise ValueError("document_has_no_version")

    provider_name = (provider or signature_type or "in_app").strip().lower()
    try:
        esign = get_provider(provider_name)
    except KeyError as error:
        raise ValueError(str(error)) from error

    if not esign.is_available():
        raise ValueError(f"provider_unavailable:{esign.name}")

    if is_main_contract(doc):
        # Подписывается конкретный текст: условия фиксируются снимком, а хэш
        # снимка — единственный допустимый content_hash (и для провайдера).
        snapshot_hash = await _freeze_contract_snapshot(db, doc, version)
        if snapshot_hash:
            if content_hash and content_hash != snapshot_hash:
                raise ValueError("content_hash_mismatch")
            content_hash = snapshot_hash

    resolved_hash = content_hash or version.checksum_sha256
    if esign.name != "in_app" and not resolved_hash:
        raise ValueError("external_signature_content_hash_required")

    # Подписывать можно только то, что можно посмотреть. Раньше договор
    # создавался вовсе без содержания — ни ссылки, ни файла, ни контрольной
    # суммы, — и подпись под этой пустотой снимала гейт начала работ.
    #
    # Проверяем сам документ, а не смету: содержание — свойство документа, и
    # правило одинаково верно для договора, пришедшего любым путём.
    #
    # Стоит после проверок провайдера намеренно: у них причина точнее, и
    # перехватывать её более общей ошибкой значило бы ухудшить диагностику.
    if doc.document_type in PARTY_SIGNED_TYPES and not _version_has_content(version):
        raise ValueError("contract_has_no_content")

    existing_query = select(DocumentSignature).where(
        DocumentSignature.document_id == doc.id,
        DocumentSignature.version_id == version.id,
        DocumentSignature.signer_user_id == signer_user_id,
        DocumentSignature.provider_name == esign.name,
        DocumentSignature.status.in_(("submitting", "pending", "signed")),
    )
    try:
        existing_query = existing_query.with_for_update()
    except Exception:
        pass
    existing_rows = list((await db.execute(existing_query)).scalars().all())
    if existing_rows:
        existing = min(
            existing_rows,
            key=lambda row: (
                0 if row.status == "signed" else 1 if row.status == "pending" else 2,
                row.id,
            ),
        )
        if existing.status == "submitting" and esign.name != "in_app":
            await dispatch_best_effort(db, source="esign.submission.retry", limit=10)
            await db.refresh(existing)
            await raise_inline_submission_error(existing)
        return existing

    request = SignRequest(
        document_id=doc.id,
        version_id=version.id,
        signer_user_id=signer_user_id,
        signer_role=signer_role,
        content_hash=resolved_hash,
        title=doc.title,
        mime_type=version.mime_type,
    )

    if esign.name == "in_app":
        result = await esign.create_signature(request)
        if result.status not in ("signed", "pending"):
            raise ValueError(result.error or f"sign_failed:{result.status}")
        if result.status == "pending" and not result.external_id:
            raise ValueError("external_signature_id_required")

        signature = DocumentSignature(
            document_id=doc.id,
            version_id=version.id,
            signer_user_id=signer_user_id,
            signer_role=signer_role,
            signature_type=result.signature_type or signature_type,
            provider_name=result.provider_name,
            provider_external_id=result.external_id,
            content_hash=resolved_hash,
            status=result.status,
            signed_at=utc_now() if result.status == "signed" else None,
            meta_json=json.dumps(result.meta, ensure_ascii=False) if result.meta else None,
        )
        db.add(signature)
        await db.flush()
        if result.status == "signed":
            await _activate_if_fully_signed(db, doc)
        return signature

    idempotency_key = signature_idempotency_key(request)
    queued_meta = {
        "submission": {
            "idempotency_key": idempotency_key,
            "state": "queued",
        }
    }
    signature = DocumentSignature(
        document_id=doc.id,
        version_id=version.id,
        signer_user_id=signer_user_id,
        signer_role=signer_role,
        signature_type=provider_name,
        provider_name=provider_name,
        provider_external_id=None,
        content_hash=resolved_hash,
        status="submitting",
        signed_at=None,
        meta_json=json.dumps(queued_meta, ensure_ascii=False),
    )
    db.add(signature)
    await db.flush()
    await outbox.enqueue(
        db,
        aggregate_type="document_signature",
        aggregate_id=signature.id,
        event_type=outbox.ESIGN_SUBMISSION_EVENT,
        payload={
            "signature_id": signature.id,
            "provider_name": provider_name,
            "idempotency_key": idempotency_key,
        },
    )
    await db.commit()

    await dispatch_best_effort(db, source="esign.submission", limit=10)
    await db.refresh(signature)
    await raise_inline_submission_error(signature)
    return signature


async def archive_document(db: AsyncSession, doc: ProjectDocument) -> ProjectDocument:
    if is_main_contract(doc):
        # Архив основного договора снимал бы (или, у подписанного, оставлял бы
        # ложно зелёным) гейт начала работ.
        raise ValueError("main_contract_protected")
    doc.status = DocumentStatus.archived.value
    doc.archived_at = utc_now()
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
    if is_main_contract(doc):
        # Без основного договора пересоздать нечем (DOC-008): гейт и старт
        # этапа расходились. Договор можно только подписать.
        raise ValueError("main_contract_protected")
    if await document_has_signatures(db, doc.id):
        raise ValueError("signed_document_cannot_be_deleted")
    doc.status = DocumentStatus.deleted.value
    doc.archived_at = utc_now()
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


async def _main_contracts(db: AsyncSession, project_id: str) -> list[ProjectDocument]:
    """Живые основные договоры проекта (без допработ, удалённых и архивных)."""
    rows = list(
        (
            await db.execute(
                select(ProjectDocument)
                .where(
                    ProjectDocument.project_id == project_id,
                    ProjectDocument.document_type == DocumentType.contract.value,
                    ProjectDocument.change_order_id.is_(None),
                    ProjectDocument.status.notin_(
                        (DocumentStatus.deleted.value, DocumentStatus.archived.value)
                    ),
                )
                .order_by(ProjectDocument.created_at.asc(), ProjectDocument.id.asc())
            )
        ).scalars().all()
    )
    return rows


async def ensure_contract_draft(
    db: AsyncSession,
    *,
    project_id: str,
    created_by: str | None,
) -> dict:
    """Создать основной договор подряда, если его ещё нет (идемпотентно).

    Документ допработ (change_order_id) договором не считается и создание не
    блокирует (DOC-007).
    """
    contracts = await _main_contracts(db, project_id)
    if contracts:
        gate = await project_contract_gate(db, project_id)
        signed_doc = gate.get("document_id") if gate.get("ok") else None
        primary = next((d for d in contracts if d.id == signed_doc), contracts[0])
        pending = [d.title for d in contracts if d.status == DocumentStatus.draft.value]
        return {"created": False, "document_id": primary.id, "pending_titles": pending[:3]}
    # Договор без содержания подписывать нечего, а подпись под ним снимала
    # гейт начала работ. Собираем существенные условия из зафиксированной
    # сметы и даём ссылку на ручку, которая рисует документ.
    from app.services import contract_document_service as contract_svc

    terms = await contract_svc.collect_terms(db, project_id)
    doc = await create_document(
        db,
        project_id=project_id,
        created_by=created_by,
        title="Договор подряда",
        document_type=DocumentType.contract.value,
        notes=contract_svc.contract_notes(terms) if terms else "Создан при фиксации сметы",
        href=contract_svc.contract_href(project_id),
    )
    doc.status = DocumentStatus.draft.value
    await db.flush()
    return {"created": True, "document_id": doc.id, "pending_titles": [doc.title]}


async def project_contract_gate(db: AsyncSession, project_id: str) -> dict:
    """Единый предикат «работы можно начинать» (/contract-gate и старт этапа).

    Гейт пройден, только если основной договор подряда подписан ТЕКУЩЕЙ
    версией всеми обязательными сторонами: заказчиком и, если исполнитель
    подключён, исполнителем-лидом. У самостоятельного заказчика (исполнителя
    нет) достаточно его подписи. Документы допработ и произвольные загрузки в
    гейт не входят. Если основного договора нет, а исполнитель подключён, гейт
    закрыт (раньше отвечал ok при отсутствии договора, а старт этапа давал 403).
    """
    project = await db.get(Project, project_id)
    if project is None:
        return {"ok": False, "code": "project_not_found", "message": "Проект не найден", "pending_titles": []}
    required = required_parties(project)
    contracts = await _main_contracts(db, project_id)
    if not contracts:
        if project.contractor_id:
            return {
                "ok": False,
                "code": "contract_not_signed",
                "reason": "no_contract",
                "message": "Основной договор подряда ещё не создан: зафиксируйте смету",
                "pending_titles": [],
                "required_parties": sorted(required),
                "signed_parties": [],
            }
        return {"ok": True, "reason": "no_contract_required"}
    best_missing: set[str] | None = None
    best: ProjectDocument | None = None
    best_signed: set[str] = set()
    for doc in contracts:
        signed = await signed_parties(db, doc, project)
        missing = required - signed
        if not missing:
            return {
                "ok": True,
                "document_id": doc.id,
                "required_parties": sorted(required),
                "signed_parties": sorted(signed),
            }
        if best_missing is None or len(missing) < len(best_missing):
            best_missing, best, best_signed = missing, doc, signed
    assert best is not None and best_missing is not None
    return {
        "ok": False,
        "code": "contract_not_signed",
        "reason": "awaiting_signatures",
        "message": "Договор должен быть подписан всеми сторонами перед началом работ",
        "pending_titles": [best.title],
        "document_id": best.id,
        "required_parties": sorted(required),
        "signed_parties": sorted(best_signed),
        "awaiting_parties": sorted(best_missing),
    }


async def complete_external_signature(
    db: AsyncSession,
    *,
    provider_name: str,
    external_id: str,
    status: str,
) -> DocumentSignature | None:
    """Apply one monotonic provider transition to a pending external signature."""
    if status not in {"pending", "signed", "failed"}:
        raise ValueError("invalid_external_signature_status")
    query = select(DocumentSignature).where(
        DocumentSignature.provider_name == provider_name,
        DocumentSignature.provider_external_id == external_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    rows = list((await db.execute(query)).scalars().all())
    if not rows:
        return None
    if len(rows) != 1:
        raise ValueError("duplicate_provider_external_id")
    signature = rows[0]

    current = str(signature.status or "")
    if current in {"signed", "failed"}:
        if current == status:
            return signature
        raise ValueError("signature_final_state_conflict")
    if current != "pending":
        raise ValueError("signature_not_pending")
    if status == "pending":
        return signature

    signature.status = status
    if status == "signed":
        signature.signed_at = utc_now()
        signature.revoked_at = None
        doc = await db.get(ProjectDocument, signature.document_id)
        await db.flush()
        if doc:
            await _activate_if_fully_signed(db, doc)
    else:
        signature.revoked_at = utc_now()
        signature.signed_at = None
    await db.flush()
    return signature
