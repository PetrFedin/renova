"""Retryable external e-sign submission executed from the transactional outbox."""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentVersion,
    ProjectDocument,
)
from app.services.esign.base import SignRequest
from app.services.esign.registry import get_provider


async def process_external_signature_submission(
    db: AsyncSession,
    payload: dict,
) -> DocumentSignature:
    """Submit one durable intent and persist the provider result atomically.

    The caller owns the outbox lease. If committing the signature result fails,
    both this mutation and the outbox completion roll back; the next worker calls
    the provider again with the same idempotency key.
    """
    signature_id = str(payload.get("signature_id") or "")
    provider_name = str(payload.get("provider_name") or "").strip().lower()
    idempotency_key = str(payload.get("idempotency_key") or "").strip()
    if not signature_id or not provider_name or not idempotency_key:
        raise RuntimeError("esign_submission_payload_invalid")

    query = select(DocumentSignature).where(DocumentSignature.id == signature_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    signature = (await db.execute(query)).scalar_one_or_none()
    if signature is None:
        raise RuntimeError("esign_submission_signature_missing")
    if signature.provider_name != provider_name:
        raise RuntimeError("esign_submission_provider_mismatch")
    if signature.status in {"pending", "signed"}:
        return signature
    if signature.status != "submitting":
        raise RuntimeError(f"esign_submission_invalid_state:{signature.status}")

    document = await db.get(ProjectDocument, signature.document_id)
    version = await db.get(DocumentVersion, signature.version_id)
    if document is None or version is None or version.document_id != document.id:
        raise RuntimeError("esign_submission_document_missing")

    try:
        provider = get_provider(provider_name)
    except KeyError as error:
        raise RuntimeError("esign_submission_provider_unknown") from error
    if not provider.is_available():
        raise RuntimeError(f"provider_unavailable:{provider_name}")

    result = await provider.create_signature(
        SignRequest(
            document_id=document.id,
            version_id=version.id,
            signer_user_id=signature.signer_user_id,
            signer_role=signature.signer_role,
            content_hash=signature.content_hash or version.checksum_sha256,
            title=document.title,
            mime_type=version.mime_type,
            idempotency_key=idempotency_key,
        )
    )
    if result.provider_name != provider_name:
        raise RuntimeError("esign_submission_result_provider_mismatch")
    if result.status not in {"pending", "signed"}:
        raise RuntimeError(result.error or f"esign_submission_failed:{result.status}")
    if result.status == "pending" and not result.external_id:
        raise RuntimeError("external_signature_id_required")

    submission_meta = {
        "idempotency_key": idempotency_key,
        "state": "accepted",
        "provider_external_id": result.external_id,
    }
    meta = dict(result.meta or {})
    meta["submission"] = submission_meta

    signature.signature_type = result.signature_type or provider_name
    signature.provider_external_id = result.external_id
    signature.status = result.status
    signature.signed_at = utc_now() if result.status == "signed" else None
    signature.revoked_at = None
    signature.meta_json = json.dumps(meta, ensure_ascii=False)
    if result.status == "signed" and document.status == DocumentStatus.draft.value:
        document.status = DocumentStatus.active.value
    await db.flush()
    return signature
