"""ORM safety net for legacy fiscal receipt verification states."""
from __future__ import annotations

from sqlalchemy import event

from app.models.entities import Receipt
from app.services.fns.receipt_verify import VERIFIED_LIVE


def _is_fiscal_receipt(receipt: Receipt) -> bool:
    return str(getattr(receipt, "fn", "") or "").upper() != "MANUAL"


@event.listens_for(Receipt, "load")
def normalize_loaded_receipt_truth(receipt: Receipt, _context) -> None:
    """Never expose legacy/demo fiscal flags as live provider evidence in memory."""
    if _is_fiscal_receipt(receipt) and str(receipt.verification_status or "") != VERIFIED_LIVE:
        receipt.fns_verified = False


@event.listens_for(Receipt, "before_update")
def normalize_updated_receipt_truth(_mapper, _connection, receipt: Receipt) -> None:
    """Prevent non-live fiscal receipts from persisting fns_verified=True."""
    if _is_fiscal_receipt(receipt) and str(receipt.verification_status or "") != VERIFIED_LIVE:
        receipt.fns_verified = False
