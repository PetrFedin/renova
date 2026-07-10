"""Платежи: авансы, этапы, закупка материалов."""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Payment, PaymentStatus, PaymentType, Project


async def create_payment(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    title: str,
    amount: float,
    payment_type: str,
    stage_id: str | None = None,
    notes: str | None = None,
) -> Payment:
    payment = Payment(
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType(payment_type),
        title=title,
        amount=amount,
        created_by=user_id,
        notes=notes,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment


async def confirm_payment(
    db: AsyncSession,
    payment_id: str,
    *,
    project_id: str | None = None,
    allow_without_acceptance: bool = False,
) -> Payment | None:
    payment = await db.get(Payment, payment_id)
    if not payment or payment.status != PaymentStatus.pending:
        return None
    if project_id is not None and payment.project_id != project_id:
        return None

    if payment.payment_type == PaymentType.stage and payment.stage_id and not allow_without_acceptance:
        from app.models.entities import Stage

        stage = await db.get(Stage, payment.stage_id)
        if not stage or stage.project_id != payment.project_id or not stage.customer_accepted_at:
            return None

    payment.status = PaymentStatus.confirmed
    payment.confirmed_at = datetime.utcnow()
    project = await db.get(Project, payment.project_id)
    if project:
        project.budget_spent = round(project.budget_spent + payment.amount, 2)

    from app.services import budget_service as budget

    await budget.expense_from_payment(db, payment)
    await db.commit()
    await db.refresh(payment)
    return payment


async def get_payment(db: AsyncSession, payment_id: str) -> Payment | None:
    return await db.get(Payment, payment_id)


async def receipt_id_for_payment(db: AsyncSession, payment_id: str) -> str | None:
    from app.models.entities import Receipt

    result = await db.execute(select(Receipt.id).where(Receipt.payment_id == payment_id).limit(1))
    return result.scalar_one_or_none()


async def list_payments(db: AsyncSession, project_id: str) -> list[Payment]:
    result = await db.execute(
        select(Payment)
        .where(Payment.project_id == project_id)
        .order_by(Payment.created_at.desc())
    )
    return list(result.scalars().all())


def payment_dict(payment: Payment, *, receipt_id: str | None = None) -> dict:
    return {
        "id": payment.id,
        "title": payment.title,
        "amount": payment.amount,
        "payment_type": payment.payment_type.value,
        "status": payment.status.value,
        "stage_id": payment.stage_id,
        "notes": payment.notes,
        "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
        "created_at": payment.created_at.isoformat(),
        "receipt_id": receipt_id,
    }
