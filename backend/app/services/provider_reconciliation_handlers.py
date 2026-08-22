"""Provider-specific reconciliation handlers.

Handlers update existing domain sources of truth. They never store provider raw
payloads in the reconciliation ledger.
"""
from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Payment, PaymentStatus, Project, Receipt
from app.services import payment_checkout_service as checkout
from app.services import payment_reversal_service as reversal
from app.services import payment_service
from app.services import provider_reconciliation_service as ledger
from app.services.fns import receipt_verify as fns

FNS_PROVIDER = "fns"
FNS_RECEIPT_OPERATION = "receipt_verify"
YOOKASSA_PROVIDER = "yookassa"
YOOKASSA_PAYMENT_OPERATION = "payment_status"


async def seed_pending_fns_receipts(db: AsyncSession, *, limit: int = 100) -> int:
    receipt_ids = (
        await db.execute(
            select(Receipt.id)
            .where(Receipt.verification_status == fns.VERIFICATION_PENDING)
            .order_by(Receipt.created_at.asc())
            .limit(max(1, min(int(limit), 500)))
        )
    ).scalars().all()
    for receipt_id in receipt_ids:
        await ledger.ensure_reconciliation(
            db,
            provider=FNS_PROVIDER,
            operation_type=FNS_RECEIPT_OPERATION,
            resource_type="receipt",
            resource_id=receipt_id,
        )
    await db.flush()
    return len(receipt_ids)


async def seed_pending_yookassa_payments(db: AsyncSession, *, limit: int = 100) -> int:
    payment_ids = (
        await db.execute(
            select(Payment.id)
            .where(
                Payment.yookassa_payment_id.is_not(None),
                Payment.status.in_((PaymentStatus.pending, PaymentStatus.processing)),
            )
            .order_by(Payment.created_at.asc())
            .limit(max(1, min(int(limit), 500)))
        )
    ).scalars().all()
    for payment_id in payment_ids:
        payment = await db.get(Payment, payment_id)
        if not payment or not payment.yookassa_payment_id:
            continue
        await ledger.ensure_reconciliation(
            db,
            provider=YOOKASSA_PROVIDER,
            operation_type=YOOKASSA_PAYMENT_OPERATION,
            resource_type="payment",
            resource_id=payment.id,
            provider_resource_id=payment.yookassa_payment_id,
        )
    await db.flush()
    return len(payment_ids)


async def seed_pending_provider_work(db: AsyncSession, *, limit: int = 100) -> int:
    per_provider = max(1, min(int(limit), 500))
    return (
        await seed_pending_fns_receipts(db, limit=per_provider)
        + await seed_pending_yookassa_payments(db, limit=per_provider)
    )


async def reconcile_fns_receipt(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
) -> bool:
    if (
        claim.provider != FNS_PROVIDER
        or claim.operation_type != FNS_RECEIPT_OPERATION
        or claim.resource_type != "receipt"
    ):
        return False

    receipt = await db.get(Receipt, claim.resource_id)
    if receipt is None:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="receipt_not_found",
        )

    truth = fns.receipt_verification_truth(
        receipt.verification_status,
        receipt.fns_verified,
    )
    if truth["final"]:
        return await ledger.mark_completed(
            db,
            claim,
            worker_id=worker_id,
            provider_status=receipt.verification_status,
        )

    parsed = fns.parse_receipt_qr(receipt.qr_raw)
    result = await fns.verify_receipt(parsed)
    status = str(result.get("verification_status") or result.get("status") or fns.VERIFICATION_FAILED)
    verified = bool(result.get("verified") and status == fns.VERIFIED_LIVE)

    receipt.verification_status = status
    receipt.fns_verified = verified
    await db.flush()

    if verified:
        return await ledger.mark_completed(
            db,
            claim,
            worker_id=worker_id,
            provider_status=status,
        )
    if bool(result.get("retryable")):
        return await ledger.mark_retry(
            db,
            claim,
            worker_id=worker_id,
            error_code=f"fns_{status}",
            provider_status=status,
        )
    return await ledger.mark_terminal(
        db,
        claim,
        worker_id=worker_id,
        error_code=f"fns_{status}",
        provider_status=status,
    )


async def _yookassa_transport_failure(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
    exc: Exception,
) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code in (401, 403):
            return await ledger.mark_terminal(
                db,
                claim,
                worker_id=worker_id,
                error_code="yookassa_credentials_rejected",
                error=exc,
                unavailable=True,
            )
        if status_code == 404:
            return await ledger.mark_terminal(
                db,
                claim,
                worker_id=worker_id,
                error_code="yookassa_payment_not_found",
                error=exc,
            )
        if status_code == 429 or status_code >= 500:
            return await ledger.mark_retry(
                db,
                claim,
                worker_id=worker_id,
                error_code=f"yookassa_http_{status_code}",
                error=exc,
            )
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code=f"yookassa_http_{status_code}",
            error=exc,
        )
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return await ledger.mark_retry(
            db,
            claim,
            worker_id=worker_id,
            error_code="yookassa_transport_error",
            error=exc,
        )
    return await ledger.mark_terminal(
        db,
        claim,
        worker_id=worker_id,
        error_code="yookassa_unavailable",
        error=exc,
        unavailable=True,
    )


async def reconcile_yookassa_payment(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
) -> bool:
    if (
        claim.provider != YOOKASSA_PROVIDER
        or claim.operation_type != YOOKASSA_PAYMENT_OPERATION
        or claim.resource_type != "payment"
    ):
        return False

    payment = await db.get(Payment, claim.resource_id)
    if payment is None:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="payment_not_found",
        )
    if payment.status in {
        PaymentStatus.confirmed,
        PaymentStatus.cancelled,
        PaymentStatus.refunded,
        PaymentStatus.disputed,
    }:
        return await ledger.mark_completed(
            db,
            claim,
            worker_id=worker_id,
            provider_status=f"local_{payment.status.value}",
        )

    provider_id = payment.yookassa_payment_id or claim.provider_resource_id
    if not provider_id:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="missing_provider_payment_id",
        )

    project = await db.get(Project, payment.project_id)
    if project is None:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="project_not_found",
        )

    try:
        remote = await checkout.load_provider_payment(provider_id)
    except Exception as exc:
        return await _yookassa_transport_failure(
            db,
            claim,
            worker_id=worker_id,
            exc=exc,
        )

    if remote.get("error"):
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="yookassa_not_configured",
            unavailable=True,
        )
    if bool(remote.get("demo")):
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="yookassa_demo_not_authoritative",
            unavailable=True,
        )

    try:
        checkout.validate_provider_snapshot(
            remote,
            expected_provider_id=provider_id,
            expected_amount=float(payment.amount),
            expected_project_id=payment.project_id,
            expected_payment_id=payment.id,
            expected_user_id=project.customer_id,
        )
    except checkout.CheckoutIntegrityError as exc:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code=exc.code or "yookassa_snapshot_mismatch",
            error=exc,
        )

    remote_amount = remote.get("remote_amount")
    remote_currency = remote.get("remote_currency")
    if remote_amount is None or not remote_currency:
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code="yookassa_money_missing",
        )

    status = str(remote.get("status") or "")
    if status in {"pending", "waiting_for_capture"}:
        return await ledger.mark_retry(
            db,
            claim,
            worker_id=worker_id,
            error_code="yookassa_not_terminal",
            provider_status=status,
            exhaustible=False,
        )
    if status == "succeeded":
        confirmed = await payment_service.confirm_payment(
            db,
            payment.id,
            project_id=payment.project_id,
            allow_without_acceptance=False,
            allow_without_settlement=True,
            machine_source="reconciliation",
            commit=False,
        )
        if confirmed is None:
            # Provider truth is already final. Keep reconciling until the local
            # acceptance invariant permits the corresponding financial move.
            return await ledger.mark_retry(
                db,
                claim,
                worker_id=worker_id,
                error_code="local_acceptance_pending",
                provider_status=status,
                exhaustible=False,
            )
        return await ledger.mark_completed(
            db,
            claim,
            worker_id=worker_id,
            provider_status=status,
        )
    if status == "canceled":
        result = await reversal.apply_provider_cancellation(
            db,
            payment_id=payment.id,
            project_id=payment.project_id,
            provider_id=provider_id,
            amount=float(remote_amount),
            currency=str(remote_currency),
            reason="provider_reconciliation",
            source="reconciliation",
            commit=False,
        )
        if result.handled:
            return await ledger.mark_completed(
                db,
                claim,
                worker_id=worker_id,
                provider_status=status,
            )
        return await ledger.mark_terminal(
            db,
            claim,
            worker_id=worker_id,
            error_code=f"yookassa_cancel_{result.reason or 'unhandled'}",
            provider_status=status,
        )
    return await ledger.mark_retry(
        db,
        claim,
        worker_id=worker_id,
        error_code="yookassa_unknown_status",
        provider_status=status or None,
    )


async def reconcile_claim(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
) -> bool:
    if claim.provider == FNS_PROVIDER and claim.operation_type == FNS_RECEIPT_OPERATION:
        return await reconcile_fns_receipt(db, claim, worker_id=worker_id)
    if claim.provider == YOOKASSA_PROVIDER and claim.operation_type == YOOKASSA_PAYMENT_OPERATION:
        return await reconcile_yookassa_payment(db, claim, worker_id=worker_id)
    return await ledger.mark_terminal(
        db,
        claim,
        worker_id=worker_id,
        error_code="unsupported_provider_operation",
        unavailable=True,
    )
