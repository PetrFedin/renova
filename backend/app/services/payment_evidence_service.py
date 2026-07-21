"""Ручное подтверждение банковского перевода (не YuKassa).

State machine (canonical PaymentStatus):
  pending|processing|rejected → submit evidence → paid_unverified
  paid_unverified → approve → confirmed (+ budget_spent)
  paid_unverified → reject (reason) → rejected

Submit ≠ confirmed. Antivirus pipeline отсутствует — antivirus_scanned всегда False.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    Payment,
    PaymentEvidence,
    PaymentEvent,
    PaymentStatus,
    Project,
    User,
    UserRole,
    _uuid,
)

MAX_EVIDENCE_BYTES = 20 * 1024 * 1024
ALLOWED_MIME = {
    "application/pdf": [b"%PDF"],
    "image/jpeg": [bytes([0xFF, 0xD8, 0xFF])],
    "image/jpg": [bytes([0xFF, 0xD8, 0xFF])],  # alias → normalized to jpeg
    "image/png": [b"\x89PNG\r\n\x1a\n"],
}


def _normalize_mime(raw: str | None) -> str:
    m = (raw or "").split(";")[0].strip().lower()
    if m == "image/jpg":
        return "image/jpeg"
    return m


def detect_mime_from_bytes(data: bytes) -> str | None:
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if len(data) >= 3 and data[0:3] == bytes([0xFF, 0xD8, 0xFF]):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def validate_evidence_file(*, data: bytes, claimed_mime: str | None, filename: str | None) -> tuple[str, str]:
    """Вернуть (safe_mime, safe_original_filename). Не доверяем client MIME."""
    if not data:
        raise HTTPException(400, detail={"code": "empty_file", "message": "Пустой файл"})
    if len(data) > MAX_EVIDENCE_BYTES:
        raise HTTPException(413, detail={"code": "file_too_large", "message": "Файл больше 20 МБ"})

    detected = detect_mime_from_bytes(data)
    claimed = _normalize_mime(claimed_mime)
    if not detected:
        raise HTTPException(
            400,
            detail={"code": "unsupported_mime", "message": "Поддерживаются PDF, JPG, JPEG, PNG"},
        )
    if claimed and claimed not in ALLOWED_MIME and claimed != detected:
        raise HTTPException(
            400,
            detail={"code": "mime_spoof", "message": "MIME файла не совпадает с содержимым"},
        )
    if claimed and claimed != detected and claimed in ALLOWED_MIME:
        # client claim differs from magic — trust magic, reject spoof attempt
        raise HTTPException(
            400,
            detail={"code": "mime_spoof", "message": "Заявленный тип файла не совпадает с сигнатурой"},
        )
    mime = detected
    # safe original name for metadata only (not storage path)
    raw_name = (filename or "evidence").split("/")[-1].split("\\")[-1]
    raw_name = re.sub(r"[^\w.\-а-яА-ЯёЁ ]+", "_", raw_name)[:180] or "evidence"
    return mime, raw_name


def evidence_dict(ev: PaymentEvidence, *, include_storage_key: bool = False) -> dict[str, Any]:
    out = {
        "id": ev.id,
        "payment_id": ev.payment_id,
        "project_id": ev.project_id,
        "version": ev.version,
        "row_status": ev.row_status,
        "claimed_amount": ev.claimed_amount,
        "transfer_date": ev.transfer_date.isoformat() if isinstance(ev.transfer_date, date) else str(ev.transfer_date),
        "comment": ev.comment,
        "payment_reference": ev.payment_reference,
        "original_filename": ev.original_filename,
        "mime_type": ev.mime_type,
        "file_size": ev.file_size,
        "checksum_sha256": ev.checksum_sha256,
        "uploaded_by": ev.uploaded_by,
        "antivirus_scanned": bool(ev.antivirus_scanned),
        "antivirus_status": "not_configured",
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
        "reviewed_by": ev.reviewed_by,
        "reviewed_at": ev.reviewed_at.isoformat() if ev.reviewed_at else None,
        "reject_reason": ev.reject_reason,
    }
    if include_storage_key:
        out["storage_key"] = ev.storage_key
    return out


def _audit(
    db: AsyncSession,
    *,
    payment: Payment,
    actor_id: str | None,
    old_status: str | None,
    new_status: str,
    evidence_type: str,
    evidence_ref: str | None,
    note: str | None,
    idempotency_key: str | None = None,
) -> None:
    db.add(
        PaymentEvent(
            id=_uuid(),
            payment_id=payment.id,
            actor_user_id=actor_id,
            source="manual",
            old_status=old_status,
            new_status=new_status,
            evidence_type=evidence_type,
            evidence_ref=evidence_ref,
            idempotency_key=idempotency_key,
            note=(note or "")[:500] or None,
        )
    )


def can_submit_evidence(user: User, project: Project, payment: Payment) -> bool:
    if payment.project_id != project.id:
        return False
    if user.role != UserRole.customer or user.id != project.customer_id:
        return False
    # Не смешиваем с подтверждённым эквайрингом
    if payment.status == PaymentStatus.confirmed:
        return False
    if payment.status in (PaymentStatus.cancelled, PaymentStatus.refunded, PaymentStatus.disputed):
        return False
    if payment.payment_method == "yookassa" and payment.status in (
        PaymentStatus.processing,
        PaymentStatus.confirmed,
    ):
        return False
    return payment.status in (
        PaymentStatus.pending,
        PaymentStatus.processing,
        PaymentStatus.paid_unverified,
        PaymentStatus.rejected,
    )


def can_review_evidence(user: User, project: Project) -> bool:
    """Исполнитель объекта (contractor_id). Admin role в продукте нет."""
    return bool(project.contractor_id and user.id == project.contractor_id)


async def get_active_evidence(db: AsyncSession, payment_id: str) -> PaymentEvidence | None:
    return (
        await db.execute(
            select(PaymentEvidence).where(
                PaymentEvidence.payment_id == payment_id,
                PaymentEvidence.row_status == "active",
            ).order_by(PaymentEvidence.version.desc())
        )
    ).scalars().first()


async def submit_evidence(
    db: AsyncSession,
    *,
    project: Project,
    payment: Payment,
    user: User,
    data: bytes,
    claimed_mime: str | None,
    filename: str | None,
    claimed_amount: float,
    transfer_date: date,
    comment: str | None,
    payment_reference: str | None,
    idempotency_key: str | None,
    expected_lock_version: int | None = None,
) -> dict[str, Any]:
    if not can_submit_evidence(user, project, payment):
        raise HTTPException(403, detail={"code": "evidence_submit_forbidden", "message": "Нет права отправить подтверждение"})

    if expected_lock_version is not None and int(payment.lock_version or 0) != int(expected_lock_version):
        raise HTTPException(409, detail={"code": "payment_version_conflict", "message": "Платёж изменился — обновите экран"})

    mime, safe_name = validate_evidence_file(data=data, claimed_mime=claimed_mime, filename=filename)
    checksum = hashlib.sha256(data).hexdigest()
    key = (idempotency_key or "").strip()[:128] or None

    if key:
        existing = (
            await db.execute(
                select(PaymentEvidence).where(
                    PaymentEvidence.payment_id == payment.id,
                    PaymentEvidence.idempotency_key == key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            if existing.checksum_sha256 != checksum or abs(existing.claimed_amount - float(claimed_amount)) > 0.001:
                raise HTTPException(
                    409,
                    detail={
                        "code": "evidence_idempotency_conflict",
                        "message": "Тот же ключ уже использован с другим файлом/суммой",
                    },
                )
            return {
                "ok": True,
                "idempotent_replay": True,
                "payment": None,  # filled by caller
                "evidence": evidence_dict(existing),
                "notified": False,
            }

    from app.services import storage_service as storage_svc

    storage_key, _href = await storage_svc.save_bytes(
        data,
        folder=f"documents/{project.id}/payments/{payment.id}",
        filename=f"evidence.{mime.split('/')[-1]}",
        content_type=mime,
    )

    # supersede previous active
    prev = await get_active_evidence(db, payment.id)
    next_version = (prev.version + 1) if prev else 1
    replace = bool(prev)
    if prev:
        prev.row_status = "superseded"

    old_status = payment.status.value
    ev = PaymentEvidence(
        id=_uuid(),
        payment_id=payment.id,
        project_id=project.id,
        version=next_version,
        row_status="active",
        claimed_amount=float(claimed_amount),
        transfer_date=transfer_date,
        comment=(comment.strip()[:2000] if comment and comment.strip() else None),
        payment_reference=(payment_reference.strip()[:255] if payment_reference and payment_reference.strip() else None),
        storage_key=storage_key,
        original_filename=safe_name,
        mime_type=mime,
        file_size=len(data),
        checksum_sha256=checksum,
        uploaded_by=user.id,
        idempotency_key=key,
        antivirus_scanned=False,
        created_at=utc_now(),
    )
    db.add(ev)

    payment.status = PaymentStatus.paid_unverified
    payment.payment_method = payment.payment_method or "bank_transfer"
    payment.lock_version = int(payment.lock_version or 0) + 1

    _audit(
        db,
        payment=payment,
        actor_id=user.id,
        old_status=old_status,
        new_status=PaymentStatus.paid_unverified.value,
        evidence_type="transfer_screenshot" if replace else "bank_statement",
        evidence_ref=ev.id,
        note="evidence_replaced" if replace else "evidence_submitted",
        idempotency_key=key,
    )

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        if key:
            existing = (
                await db.execute(
                    select(PaymentEvidence).where(
                        PaymentEvidence.payment_id == payment.id,
                        PaymentEvidence.idempotency_key == key,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                return {
                    "ok": True,
                    "idempotent_replay": True,
                    "payment": None,
                    "evidence": evidence_dict(existing),
                    "notified": False,
                }
        raise HTTPException(409, detail={"code": "evidence_conflict", "message": "Конфликт при сохранении"})

    await db.commit()
    await db.refresh(payment)
    await db.refresh(ev)
    return {
        "ok": True,
        "idempotent_replay": False,
        "replaced": replace,
        "payment": payment,
        "evidence": evidence_dict(ev),
        "notified": True,
    }


async def approve_evidence(
    db: AsyncSession,
    *,
    project: Project,
    payment: Payment,
    user: User,
    expected_lock_version: int | None = None,
) -> Payment:
    if not can_review_evidence(user, project):
        raise HTTPException(403, detail={"code": "evidence_approve_forbidden", "message": "Подтверждает исполнитель объекта"})
    if payment.project_id != project.id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    if payment.status != PaymentStatus.paid_unverified:
        raise HTTPException(409, detail={"code": "invalid_payment_state", "message": "Платёж не ожидает проверки"})
    if expected_lock_version is not None and int(payment.lock_version or 0) != int(expected_lock_version):
        raise HTTPException(409, detail={"code": "payment_version_conflict", "message": "Платёж изменился"})

    ev = await get_active_evidence(db, payment.id)
    if not ev:
        raise HTTPException(409, detail={"code": "evidence_missing", "message": "Нет активного подтверждения"})

    # Optimistic: UPDATE only if still paid_unverified
    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.status == PaymentStatus.paid_unverified,
            Payment.lock_version == int(payment.lock_version or 0),
        )
        .values(
            status=PaymentStatus.confirmed,
            confirmed_at=utc_now(),
            lock_version=int(payment.lock_version or 0) + 1,
            payment_method=payment.payment_method or "bank_transfer",
        )
    )
    if result.rowcount != 1:
        raise HTTPException(409, detail={"code": "concurrent_review", "message": "Платёж уже обработан другим действием"})

    ev.reviewed_by = user.id
    ev.reviewed_at = utc_now()
    ev.reject_reason = None

    _audit(
        db,
        payment=payment,
        actor_id=user.id,
        old_status=PaymentStatus.paid_unverified.value,
        new_status=PaymentStatus.confirmed.value,
        evidence_type="manual_review",
        evidence_ref=ev.id,
        note="evidence_approved",
    )

    proj = await db.get(Project, project.id)
    if proj:
        proj.budget_spent = round(float(proj.budget_spent or 0) + float(payment.amount), 2)
    from app.services import budget_service as budget

    # refresh payment for expense
    await db.refresh(payment)
    payment.status = PaymentStatus.confirmed
    await budget.expense_from_payment(db, payment)
    await db.commit()
    await db.refresh(payment)
    return payment


async def reject_evidence(
    db: AsyncSession,
    *,
    project: Project,
    payment: Payment,
    user: User,
    reason: str,
    expected_lock_version: int | None = None,
) -> Payment:
    if not can_review_evidence(user, project):
        raise HTTPException(403, detail={"code": "evidence_reject_forbidden", "message": "Отклоняет исполнитель объекта"})
    reason_clean = (reason or "").strip()
    if len(reason_clean) < 3:
        raise HTTPException(400, detail={"code": "reject_reason_required", "message": "Укажите причину отклонения"})
    if payment.project_id != project.id:
        raise HTTPException(404, detail={"code": "payment_not_found", "message": "Платёж не найден"})
    if payment.status != PaymentStatus.paid_unverified:
        raise HTTPException(409, detail={"code": "invalid_payment_state", "message": "Платёж не ожидает проверки"})
    if expected_lock_version is not None and int(payment.lock_version or 0) != int(expected_lock_version):
        raise HTTPException(409, detail={"code": "payment_version_conflict", "message": "Платёж изменился"})

    ev = await get_active_evidence(db, payment.id)
    if not ev:
        raise HTTPException(409, detail={"code": "evidence_missing", "message": "Нет активного подтверждения"})

    result = await db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.status == PaymentStatus.paid_unverified,
            Payment.lock_version == int(payment.lock_version or 0),
        )
        .values(
            status=PaymentStatus.rejected,
            lock_version=int(payment.lock_version or 0) + 1,
        )
    )
    if result.rowcount != 1:
        raise HTTPException(409, detail={"code": "concurrent_review", "message": "Платёж уже обработан другим действием"})

    ev.reviewed_by = user.id
    ev.reviewed_at = utc_now()
    ev.reject_reason = reason_clean[:2000]

    _audit(
        db,
        payment=payment,
        actor_id=user.id,
        old_status=PaymentStatus.paid_unverified.value,
        new_status=PaymentStatus.rejected.value,
        evidence_type="manual_review",
        evidence_ref=ev.id,
        note=f"evidence_rejected:{reason_clean[:120]}",
    )
    await db.commit()
    await db.refresh(payment)
    return payment
