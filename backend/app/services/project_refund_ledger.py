"""Project payment refund money: original invoice immutable, refunds as a separate ledger.

Only the provider webhook writes ProjectPaymentRefund. Reconciliation and every
expense source hydrate the same net value instead of restoring gross spend.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_payment_refund import ProjectPaymentRefund

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value: Decimal | float | int | str) -> Decimal:
    """Reject invalid/rounded provider money, never silently correct it."""
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("refund_amount_invalid") from exc
    if not result.is_finite() or result <= 0 or result != result.quantize(CENT):
        raise ValueError("refund_amount_invalid")
    return result


def invoice_money(value: Decimal | float | int | str) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("payment_amount_invalid") from exc
    if not result.is_finite() or result <= 0 or result != result.quantize(CENT):
        raise ValueError("payment_amount_invalid")
    return result


async def refunded_total(db: AsyncSession, payment_id: str) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(ProjectPaymentRefund.amount), 0)).where(
            ProjectPaymentRefund.payment_id == payment_id
        )
    )
    return Decimal(str(total or 0)).quantize(CENT)


async def refund_totals_by_payment(
    db: AsyncSession, payment_ids: list[str],
) -> dict[str, Decimal]:
    if not payment_ids:
        return {}
    rows = (
        await db.execute(
            select(
                ProjectPaymentRefund.payment_id,
                func.sum(ProjectPaymentRefund.amount),
            )
            .where(ProjectPaymentRefund.payment_id.in_(payment_ids))
            .group_by(ProjectPaymentRefund.payment_id)
        )
    ).all()
    return {
        payment_id: Decimal(str(total)).quantize(CENT)
        for payment_id, total in rows
    }


async def net_payment_amount(db: AsyncSession, payment_id: str, gross_amount: float) -> float:
    net = invoice_money(gross_amount) - await refunded_total(db, payment_id)
    if net < ZERO:
        raise ValueError("refund_ledger_exceeds_payment")
    return float(net)
