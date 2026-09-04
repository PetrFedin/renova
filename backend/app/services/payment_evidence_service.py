"""Manual bank-transfer evidence lifecycle on current payment truth."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Payment, PaymentStatus, Project, User, UserRole
from app.models.payment_evidence import PaymentEvidence
from app.services import storage_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

UPLOAD_INTENT_SCOPE = "payment_evidence.upload_intent"
SUBMIT_SCOPE = "payment_evidence.submit"
MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
ALLOWED_DECLARED_TYPES = frozenset({"image/jpeg", "image/png", "application/pdf"})


class PaymentEvidenceError(ValueError):
    pass


@dataclass(frozen=True)
class EvidenceValidation:
    content_type: str
    byte_size: int
    sha256: str


def _safe_filename(value: str) -> str:
    name = (value or "").strip().replace("/", "_").replace("\\", "_")
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name)[-120:]
    if not name or name in {".", ".."}:
        raise PaymentEvidenceError("invalid_filename")
    return name


def _extension_for(content_type: str) -> str:
    return {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}[content_type]


def validate_evidence_bytes(data: bytes, *, declared_content_type: str) -> EvidenceValidation:
    if declared_content_type not in ALLOWED_DECLARED_TYPES:
        raise PaymentEvidenceError("unsupported_evidence_type")
    if not data:
        raise PaymentEvidenceError("empty_evidence")
    if len(data) > MAX_EVIDENCE_BYTES:
        raise PaymentEvidenceError("evidence_too_large")

    if data.startswith(b"\xff\xd8\xff"):
        actual = "image/jpeg"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        actual = "image/png"
    elif data.startswith(b"%PDF-"):
        actual = "application/pdf"
    else:
        raise PaymentEvidenceError("unsupported_evidence_magic")
    if actual != declared_content_type:
        raise PaymentEvidenceError("evidence_mime_mismatch")
    return EvidenceValidation(
        content_type=actual,
        byte_size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )


async def _exact_payment(db: AsyncSession, *, project_id: str, payment_id: str) -> Payment:
    payment = await db.get(Payment, payment_id)
    if not payment or payment.project_id != project_id:
        raise PaymentEvidenceError("payment_not_found")
    return payment


async def _assert_customer(db: AsyncSession, *, project_id: str, user: User) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise PaymentEvidenceError("project_not_found")
    if user.role != UserRole.customer or project.customer_id != user.id:
        raise PaymentEvidenceError("customer_required")
    return project


async def get_evidence(db: AsyncSession, evidence_id: str) -> PaymentEvidence | None:
    return await db.get(PaymentEvidence, evidence_id)


async def list_payment_evidence(
    db: AsyncSession, *, project_id: str, payment_id: str
) -> list[PaymentEvidence]:
    await _exact_payment(db, project_id=project_id, payment_id=payment_id)
    result = await db.execute(
        select(PaymentEvidence)
        .where(
            PaymentEvidence.project_id == project_id,
            PaymentEvidence.payment_id == payment_id,
        )
        .order_by(PaymentEvidence.version.desc())
    )
    return list(result.scalars().all())


async def prepare_upload_intent(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
    user: User,
    client_request_id: str,
    original_filename: str,
    content_type: str,
) -> tuple[PaymentEvidence, bool]:
    """Persist stable private upload identity before any object-store write."""
    await _assert_customer(db, project_id=project_id, user=user)
    payment = await _exact_payment(db, project_id=project_id, payment_id=payment_id)
    if payment.status in {PaymentStatus.confirmed, PaymentStatus.cancelled, PaymentStatus.disputed, PaymentStatus.refunded}:
        raise PaymentEvidenceError("payment_terminal")
    if content_type not in ALLOWED_DECLARED_TYPES:
        raise PaymentEvidenceError("unsupported_evidence_type")
    safe_name = _safe_filename(original_filename)
    payload = {
        "payment_id": payment_id,
        "original_filename": safe_name,
        "content_type": content_type,
    }
    replay_id = await replay_entity_id(
        db,
        scope=UPLOAD_INTENT_SCOPE,
        project_id=project_id,
        user_id=user.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        existing = await db.get(PaymentEvidence, replay_id)
        if not existing or existing.payment_id != payment_id:
            raise PaymentEvidenceError("idempotency_target_missing")
        return existing, True

    latest = await db.scalar(
        select(func.max(PaymentEvidence.version)).where(PaymentEvidence.payment_id == payment_id)
    )
    version = int(latest or 0) + 1
    evidence = PaymentEvidence(
        project_id=project_id,
        payment_id=payment_id,
        version=version,
        status="upload_pending",
        storage_key="pending",
        original_filename=safe_name,
        declared_content_type=content_type,
        submitted_by=user.id,
    )
    db.add(evidence)
    await db.flush()
    evidence.storage_key = storage_service.normalize_storage_key(
        f"payment-evidence/{project_id}/{payment_id}/{evidence.id}/v{version}.{_extension_for(content_type)}"
    )
    created, canonical_id = await commit_client_write(
        db,
        scope=UPLOAD_INTENT_SCOPE,
        project_id=project_id,
        user_id=user.id,
        request_id=client_request_id,
        payload=payload,
        entity_id=evidence.id,
    )
    if not created:
        canonical = await db.get(PaymentEvidence, canonical_id)
        if not canonical:
            raise PaymentEvidenceError("idempotency_target_missing")
        return canonical, True
    await db.refresh(evidence)
    return evidence, False


async def submit_uploaded_evidence(
    db: AsyncSession,
    *,
    project_id: str,
    payment_id: str,
    evidence_id: str,
    user: User,
    client_request_id: str,
) -> tuple[PaymentEvidence, bool]:
    """Read back object, fail-closed validate it, then expose review truth."""
    await _assert_customer(db, project_id=project_id, user=user)
    payment = await _exact_payment(db, project_id=project_id, payment_id=payment_id)
    evidence = await db.get(PaymentEvidence, evidence_id)
    if not evidence or evidence.project_id != project_id or evidence.payment_id != payment_id:
        raise PaymentEvidenceError("evidence_not_found")
    if evidence.submitted_by != user.id:
        raise PaymentEvidenceError("evidence_owner_mismatch")
    payload = {"payment_id": payment_id, "evidence_id": evidence_id}
    replay_id = await replay_entity_id(
        db,
        scope=SUBMIT_SCOPE,
        project_id=project_id,
        user_id=user.id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        canonical = await db.get(PaymentEvidence, replay_id)
        if not canonical:
            raise PaymentEvidenceError("idempotency_target_missing")
        return canonical, True
    if evidence.status != "upload_pending":
        raise PaymentEvidenceError("evidence_not_upload_pending")
    if payment.status in {PaymentStatus.confirmed, PaymentStatus.cancelled, PaymentStatus.disputed, PaymentStatus.refunded}:
        raise PaymentEvidenceError("payment_terminal")

    data = await storage_service.read_bytes(evidence.storage_key)
    if data is None:
        raise PaymentEvidenceError("evidence_object_missing")
    verified = validate_evidence_bytes(data, declared_content_type=evidence.declared_content_type)
    evidence.verified_content_type = verified.content_type
    evidence.byte_size = verified.byte_size
    evidence.sha256 = verified.sha256
    evidence.status = "submitted"
    evidence.submitted_at = utc_now()
    await db.flush()

    # Evidence makes the existing manual-transfer state explicit but remains
    # non-financial. Canonical financial recognition happens only after review.
    if payment.status in {PaymentStatus.pending, PaymentStatus.processing}:
        from app.services import payment_service
        transitioned = await payment_service.confirm_payment(
            db,
            payment.id,
            project_id=project_id,
            transfer_ack=True,
            commit=False,
        )
        if not transitioned or transitioned.status != PaymentStatus.paid_unverified:
            raise PaymentEvidenceError("payment_unverified_transition_failed")

    created, canonical_id = await commit_client_write(
        db,
        scope=SUBMIT_SCOPE,
        project_id=project_id,
        user_id=user.id,
        request_id=client_request_id,
        payload=payload,
        entity_id=evidence.id,
    )
    if not created:
        canonical = await db.get(PaymentEvidence, canonical_id)
        if not canonical:
            raise PaymentEvidenceError("idempotency_target_missing")
        return canonical, True
    await db.refresh(evidence)
    return evidence, False
