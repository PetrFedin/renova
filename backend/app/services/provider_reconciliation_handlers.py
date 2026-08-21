"""Provider-specific reconciliation handlers.

Handlers update existing domain sources of truth. They never store provider raw
payloads in the reconciliation ledger.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Receipt
from app.services import provider_reconciliation_service as ledger
from app.services.fns import receipt_verify as fns

FNS_PROVIDER = "fns"
FNS_RECEIPT_OPERATION = "receipt_verify"


async def seed_pending_fns_receipts(db: AsyncSession, *, limit: int = 100) -> int:
    """Backfill/recover pending FNS intents without scanning completed history."""
    receipt_ids = (
        await db.execute(
            select(Receipt.id)
            .where(Receipt.verification_status == fns.VERIFICATION_PENDING)
            .order_by(Receipt.created_at.asc())
            .limit(max(1, min(int(limit), 500)))
        )
    ).scalars().all()
    created_or_existing = 0
    for receipt_id in receipt_ids:
        await ledger.ensure_reconciliation(
            db,
            provider=FNS_PROVIDER,
            operation_type=FNS_RECEIPT_OPERATION,
            resource_type="receipt",
            resource_id=receipt_id,
        )
        created_or_existing += 1
    await db.flush()
    return created_or_existing


async def reconcile_fns_receipt(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
) -> bool:
    """Re-read FNS truth for one receipt and persist the existing domain status."""
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

    # A concurrent/live request may already have reached authoritative final
    # truth after the worker claimed this row. Respect the domain SoT first.
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


async def reconcile_claim(
    db: AsyncSession,
    claim: ledger.ReconciliationClaim,
    *,
    worker_id: str,
) -> bool:
    if claim.provider == FNS_PROVIDER and claim.operation_type == FNS_RECEIPT_OPERATION:
        return await reconcile_fns_receipt(db, claim, worker_id=worker_id)
    return await ledger.mark_terminal(
        db,
        claim,
        worker_id=worker_id,
        error_code="unsupported_provider_operation",
        unavailable=True,
    )
