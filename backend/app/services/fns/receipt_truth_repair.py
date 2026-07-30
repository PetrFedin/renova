"""Idempotent repair for legacy receipt states that were never live-verified."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, Receipt
from app.services.fns.receipt_verify import LEGACY_DEMO_VERIFIED, SAVED_UNVERIFIED


async def repair_legacy_receipt_truth(db: AsyncSession) -> dict[str, int]:
    """Downgrade legacy demo evidence and its active ledger projections.

    Historical `demo_verified` rows may have `fns_verified=True`. They were not
    accepted by the provider and therefore cannot remain confirmed financial
    evidence. Protected dispute/refund/deleted expenses are left untouched.
    """
    receipts = list(
        (
            await db.execute(
                select(Receipt).where(
                    Receipt.verification_status == LEGACY_DEMO_VERIFIED,
                )
            )
        ).scalars().all()
    )
    if not receipts:
        return {"receipts_repaired": 0, "expenses_repaired": 0}

    receipt_ids = [receipt.id for receipt in receipts]
    for receipt in receipts:
        receipt.fns_verified = False
        receipt.verification_status = SAVED_UNVERIFIED

    expenses = list(
        (
            await db.execute(
                select(Expense).where(
                    Expense.receipt_id.in_(receipt_ids),
                    Expense.status.in_(("confirmed", "pending_receipt")),
                )
            )
        ).scalars().all()
    )
    for expense in expenses:
        expense.status = "pending_receipt"

    await db.flush()
    return {
        "receipts_repaired": len(receipts),
        "expenses_repaired": len(expenses),
    }
