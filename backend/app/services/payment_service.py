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
    p = Payment(
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType(payment_type),
        title=title,
        amount=amount,
        created_by=user_id,
        notes=notes,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def confirm_payment(db: AsyncSession, payment_id: str, *, allow_without_acceptance: bool = False) -> Payment | None:
    p = await db.get(Payment, payment_id)
    if not p or p.status != PaymentStatus.pending:
        return None
    if p.payment_type == PaymentType.stage and p.stage_id and not allow_without_acceptance:
        from app.models.entities import Stage
        stage = await db.get(Stage, p.stage_id)
        if not stage or not stage.customer_accepted_at:
            return None
    p.status = PaymentStatus.confirmed
    p.confirmed_at = datetime.utcnow()
    proj = await db.get(Project, p.project_id)
    if proj:
        proj.budget_spent = round(proj.budget_spent + p.amount, 2)
    from app.services import budget_service as bud
    await bud.expense_from_payment(db, p)
    await db.commit()
    await db.refresh(p)
    return p


async def get_payment(db: AsyncSession, payment_id: str) -> Payment | None:
    return await db.get(Payment, payment_id)


async def list_payments(db: AsyncSession, project_id: str) -> list[Payment]:
    r = await db.execute(select(Payment).where(Payment.project_id == project_id).order_by(Payment.created_at.desc()))
    return list(r.scalars().all())


def payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "amount": p.amount,
        "payment_type": p.payment_type.value,
        "status": p.status.value,
        "stage_id": p.stage_id,
        "notes": p.notes,
        "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
        "created_at": p.created_at.isoformat(),
    }
