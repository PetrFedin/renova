"""Project-scoped receipt mutations with canonical budget reconciliation."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    Payment,
    PaymentStatus,
    Receipt,
    Room,
    Stage,
)
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects


@dataclass(frozen=True)
class ReceiptMutation:
    receipt: Receipt
    changed: bool
    outbox_id: str | None = None


@dataclass(frozen=True)
class ReceiptDeletion:
    amount: float
    ledger_removed: float
    outbox_id: str


async def get_receipt(
    db: AsyncSession,
    *,
    project_id: str,
    receipt_id: str,
    for_update: bool = False,
) -> Receipt | None:
    query = select(Receipt).where(
        Receipt.id == receipt_id,
        Receipt.project_id == project_id,
    )
    if for_update:
        try:
            query = query.with_for_update()
        except Exception:
            pass
    return (await db.execute(query.limit(1))).scalar_one_or_none()


async def resolve_room_id(db: AsyncSession, *, project_id: str, room_id: str | None) -> str | None:
    if not room_id:
        return None
    found = (
        await db.execute(
            select(Room.id).where(Room.id == room_id, Room.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not found:
        raise ValueError("receipt_room_not_found")
    return found


async def resolve_stage_id(db: AsyncSession, *, project_id: str, stage_id: str | None) -> str | None:
    if not stage_id:
        return None
    found = (
        await db.execute(
            select(Stage.id).where(Stage.id == stage_id, Stage.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not found:
        raise ValueError("receipt_stage_not_found")
    return found


async def patch_receipt(
    db: AsyncSession,
    *,
    project_id: str,
    receipt_id: str,
    expense_category: str | None,
    room_id_supplied: bool,
    room_id: str | None,
    stage_id_supplied: bool,
    stage_id: str | None,
    amount: float | None,
    description_supplied: bool,
    description: str | None,
) -> Receipt | None:
    receipt = await get_receipt(
        db,
        project_id=project_id,
        receipt_id=receipt_id,
        for_update=True,
    )
    if not receipt:
        return None

    if amount is not None:
        if amount <= 0:
            raise ValueError("receipt_amount_invalid")
        if receipt.fn != "MANUAL":
            raise ValueError("fiscal_receipt_amount_immutable")
        receipt.amount = round(float(amount), 2)

    if description_supplied:
        if receipt.fn != "MANUAL":
            raise ValueError("fiscal_receipt_description_immutable")
        receipt.qr_raw = (description or "Ручной расход")[:500]

    if expense_category is not None:
        receipt.expense_category = expense_category
    if room_id_supplied:
        receipt.room_id = await resolve_room_id(
            db,
            project_id=project_id,
            room_id=room_id,
        )
    if stage_id_supplied:
        receipt.stage_id = await resolve_stage_id(
            db,
            project_id=project_id,
            stage_id=stage_id,
        )

    from app.services import budget_service as budget

    await budget.expense_from_receipt(
        db,
        receipt,
        title=receipt.qr_raw if receipt.fn == "MANUAL" else None,
    )
    await budget.refresh_budget_facts(db, project_id)
    await db.commit()
    await db.refresh(receipt)
    return receipt


def verification_status(*, verified: bool, mode: str) -> str:
    """Map provider outcome to the exact persisted state.

    A boolean alone is never enough to create live fiscal evidence. Legacy demo
    outcomes are intentionally downgraded to saved_unverified.
    """
    normalized = str(mode or "offline").strip().lower()
    if verified and normalized == "live":
        return "verified_live"
    if normalized in {"pending", "verification_pending"}:
        return "verification_pending"
    if normalized in {"failed", "verification_failed"}:
        return "verification_failed"
    if normalized == "invalid":
        return "invalid"
    if normalized == "live" and not verified:
        return "verification_failed"
    return "saved_unverified"


def _preserve_verified_live(current_status: str, next_status: str) -> bool:
    """Transient/provider configuration failures cannot revoke prior evidence."""
    return current_status == "verified_live" and next_status in {
        "verification_pending",
        "verification_failed",
        "saved_unverified",
    }


async def apply_verification_result(
    db: AsyncSession,
    *,
    project_id: str,
    receipt_id: str,
    actor_id: str,
    verified: bool,
    mode: str,
    message: str | None,
) -> ReceiptMutation:
    receipt = await get_receipt(
        db,
        project_id=project_id,
        receipt_id=receipt_id,
        for_update=True,
    )
    if not receipt:
        raise ValueError("receipt_not_found")
    if receipt.fn == "MANUAL":
        raise ValueError("manual_receipt_not_reverifiable")

    current_status = str(receipt.verification_status or "saved_unverified")
    next_status = verification_status(verified=bool(verified), mode=mode)
    if _preserve_verified_live(current_status, next_status):
        return ReceiptMutation(receipt=receipt, changed=False)

    next_verified = next_status == "verified_live"
    changed = (
        bool(receipt.fns_verified) != next_verified
        or current_status != next_status
    )
    receipt.fns_verified = next_verified
    receipt.verification_status = next_status

    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    await budget.expense_from_receipt(db, receipt)
    await budget.refresh_budget_facts(db, project_id)

    outbox_id: str | None = None
    if changed:
        if next_verified:
            kind = "ReceiptVerified"
            title = "Чек подтверждён ФНС"
        elif next_status == "verification_pending":
            kind = "ReceiptVerificationPending"
            title = "Проверка чека ожидает ответа ФНС"
        else:
            kind = "ReceiptVerificationFailed"
            title = "Проверка чека не пройдена"
        row = await outbox.enqueue(
            db,
            aggregate_type="receipt",
            aggregate_id=receipt.id,
            event_type=outbox.RECEIPT_CREATED_EVENT,
            payload={
                "project_id": project_id,
                "user_id": actor_id,
                "kind": kind,
                "title": title,
                "body": message or str(receipt.amount),
                "room_id": receipt.room_id,
                "link_path": "/(customer)/(tabs)/budget",
            },
        )
        outbox_id = row.id

    await db.commit()
    await db.refresh(receipt)
    if outbox_id:
        activate_client_write_side_effects(
            [PreparedSideEffect(effect_type="activity", outbox_id=outbox_id)]
        )
    return ReceiptMutation(receipt=receipt, changed=changed, outbox_id=outbox_id)


async def delete_receipt(
    db: AsyncSession,
    *,
    project_id: str,
    receipt_id: str,
    actor_id: str,
) -> ReceiptDeletion | None:
    receipt = await get_receipt(
        db,
        project_id=project_id,
        receipt_id=receipt_id,
        for_update=True,
    )
    if not receipt:
        return None

    if receipt.payment_id:
        payment = await db.get(Payment, receipt.payment_id)
        if payment and payment.project_id == project_id and payment.status == PaymentStatus.confirmed:
            raise ValueError("confirmed_payment_receipt_locked")

    from app.services import budget_service as budget
    from app.services import outbox_service as outbox

    amount = round(float(receipt.amount or 0), 2)
    ledger_removed = await budget.delete_receipt_expenses(db, receipt.id, rec=receipt)
    await db.delete(receipt)
    await budget.refresh_budget_facts(db, project_id)
    row = await outbox.enqueue(
        db,
        aggregate_type="receipt",
        aggregate_id=receipt_id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project_id,
            "user_id": actor_id,
            "kind": "ExpenseRemoved",
            "title": "Чек удалён",
            "body": str(amount),
            "link_path": "/(customer)/(tabs)/budget",
        },
    )
    await db.commit()
    activate_client_write_side_effects(
        [PreparedSideEffect(effect_type="activity", outbox_id=row.id)]
    )
    return ReceiptDeletion(
        amount=amount,
        ledger_removed=round(float(ledger_removed or 0), 2),
        outbox_id=row.id,
    )
