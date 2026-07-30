"""ORM safety net for legacy receipt verification states."""
from __future__ import annotations

from sqlalchemy import event

from app.models.entities import Receipt
from app.services.fns.receipt_verify import VERIFIED_LIVE


@event.listens_for(Receipt, "load")
def normalize_loaded_receipt_truth(receipt: Receipt, _context) -> None:
    """Never expose legacy/demo flags as live fiscal evidence in memory."""
    if str(receipt.verification_status or "") != VERIFIED_LIVE:
        receipt.fns_verified = False


@event.listens_for(Receipt, "before_update")
def normalize_updated_receipt_truth(_mapper, _connection, receipt: Receipt) -> None:
    """Prevent a non-live status from being persisted with fns_verified=True."""
    if str(receipt.verification_status or "") != VERIFIED_LIVE:
        receipt.fns_verified = False
