"""PostgreSQL single-winner proof for cumulative project provider refunds (#748)."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.entities import (
    DomainOutbox, Expense, Payment, PaymentEvent, PaymentStatus, PaymentType,
    Project, User, UserRole,
)
from app.models.project_payment_refund import ProjectPaymentRefund
from app.services import payment_reversal_service


def _url() -> str:
    url = os.environ.get("PROJECT_REFUND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("PROJECT_REFUND_POSTGRES_URL is set by the dedicated PostgreSQL CI gate")
    return url


@pytest.mark.asyncio
async def test_concurrent_provider_refunds_never_exceed_invoice_or_repeat_event():
    engine = create_async_engine(_url(), pool_size=4)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:10]
    customer_id = f"prf-c-{tag}"
    contractor_id = f"prf-e-{tag}"
    project_id = f"prf-proj-{tag}"
    payment_id = f"prf-pay-{tag}"
    provider_id = f"yk-prf-{tag}"

    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone=f"+7991{tag[:9].replace('a','0').replace('b','1').replace('c','2').replace('d','3').replace('e','4').replace('f','5')}",
                     role=UserRole.customer),
                User(id=contractor_id, phone=f"+7992{tag[:9].replace('a','0').replace('b','1').replace('c','2').replace('d','3').replace('e','4').replace('f','5')}",
                     role=UserRole.contractor),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="PostgreSQL refund race",
                renovation_type="cosmetic", customer_id=customer_id,
                contractor_id=contractor_id, budget_spent=5000,
            ))
            await db.flush()
            db.add(Payment(
                id=payment_id, project_id=project_id,
                payment_type=PaymentType.advance, status=PaymentStatus.confirmed,
                title="Race invoice", amount=5000, created_by=contractor_id,
                yookassa_payment_id=provider_id, payment_method="yookassa",
            ))
            await db.flush()
            db.add(Expense(
                project_id=project_id, payment_id=payment_id,
                title="Race invoice", category="works", amount=5000,
                status="confirmed",
            ))
            await db.commit()

        async def apply(refund_id: str, amount: float):
            async with Session() as db:
                result = await payment_reversal_service.apply_provider_refund(
                    db, yookassa_payment_id=provider_id, refund_id=refund_id,
                    amount=amount, currency="RUB", commit=True,
                )
                if not result.handled:
                    await db.rollback()
                return result

        # Both independently valid against 5000 gross. Only one 3000 can win.
        a, b = await asyncio.wait_for(
            asyncio.gather(apply(f"prf-over-a-{tag}", 3000), apply(f"prf-over-b-{tag}", 3000)),
            timeout=35,
        )
        assert sorted([a.handled, b.handled]) == [False, True]
        assert {a.reason, b.reason} >= {"refund_exceeds_payment"}

        async with Session() as db:
            assert (await db.get(Project, project_id)).budget_spent == 2000
            assert await db.scalar(
                select(func.count()).select_from(ProjectPaymentRefund).where(
                    ProjectPaymentRefund.payment_id == payment_id
                )
            ) == 1

        # Same provider refund ID is replayed, never booked twice.
        x, y = await asyncio.wait_for(
            asyncio.gather(apply(f"prf-duplicate-{tag}", 1000), apply(f"prf-duplicate-{tag}", 1000)),
            timeout=35,
        )
        assert x.handled and y.handled
        assert sorted([x.changed, y.changed]) == [False, True]

        async with Session() as db:
            payment = await db.get(Payment, payment_id)
            project = await db.get(Project, project_id)
            assert payment.status == PaymentStatus.confirmed
            assert project.budget_spent == 1000
            expense = (await db.execute(
                select(Expense).where(Expense.payment_id == payment_id)
            )).scalar_one()
            assert expense.amount == 1000 and expense.status == "confirmed"
            assert await db.scalar(
                select(func.count()).select_from(ProjectPaymentRefund).where(
                    ProjectPaymentRefund.payment_id == payment_id
                )
            ) == 2
            assert await db.scalar(
                select(func.count()).select_from(PaymentEvent).where(
                    PaymentEvent.payment_id == payment_id
                )
            ) == 2
            assert await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_id == payment_id
                )
            ) == 6

    finally:
        # This is a dedicated CI PostgreSQL database; clean all owned test rows.
        async with Session() as db:
            await db.execute(delete(DomainOutbox).where(DomainOutbox.aggregate_id == payment_id))
            await db.execute(delete(PaymentEvent).where(PaymentEvent.payment_id == payment_id))
            await db.execute(delete(ProjectPaymentRefund).where(ProjectPaymentRefund.payment_id == payment_id))
            await db.execute(delete(Expense).where(Expense.payment_id == payment_id))
            await db.execute(delete(Payment).where(Payment.id == payment_id))
            await db.execute(delete(Project).where(Project.id == project_id))
            await db.execute(delete(User).where(User.id.in_([customer_id, contractor_id])))
            await db.commit()
        await engine.dispose()
