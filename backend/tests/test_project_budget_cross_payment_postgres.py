"""Cross-payment PostgreSQL regression: the project net budget is one serialized fact."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.entities import (
    BudgetLine, DomainOutbox, Expense, Payment, PaymentEvent, PaymentStatus,
    PaymentType, Project, User, UserRole,
)
from app.models.project_payment_refund import ProjectPaymentRefund
from app.services import payment_reversal_service
from app.services.project_budget_lock import lock_project_budget_projection


@pytest.mark.asyncio
async def test_different_payments_refund_project_spend_is_serialized():
    url = os.environ.get("PROJECT_REFUND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("dedicated migrated PostgreSQL CI database required")

    engine = create_async_engine(url, pool_size=5, max_overflow=0)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:10]
    customer_id, contractor_id = f"prj-c-{tag}", f"prj-e-{tag}"
    project_id = f"prj-project-{tag}"
    payment_ids = [f"prj-payment-{tag}-{i}" for i in range(2)]
    provider_ids = [f"prj-yk-{tag}-{i}" for i in range(2)]
    refund_ids = [f"prj-refund-{tag}-{i}" for i in range(2)]
    phones = [f"+7991{int(tag, 16) % 10**9:09d}", f"+7992{int(tag, 16) % 10**9:09d}"]

    try:
        async with Session() as db:
            db.add_all([
                User(id=customer_id, phone=phones[0], role=UserRole.customer),
                User(id=contractor_id, phone=phones[1], role=UserRole.contractor),
            ])
            await db.flush()
            db.add(Project(
                id=project_id, name="Cross-payment refund PostgreSQL race",
                renovation_type="cosmetic", customer_id=customer_id,
                contractor_id=contractor_id, budget_spent=10000,
            ))
            await db.flush()
            for payment_id, provider_id in zip(payment_ids, provider_ids):
                db.add(Payment(
                    id=payment_id, project_id=project_id,
                    payment_type=PaymentType.advance, status=PaymentStatus.confirmed,
                    title="Shared budget invoice", amount=5000, created_by=contractor_id,
                    yookassa_payment_id=provider_id, payment_method="yookassa",
                ))
            # Persist both payment parents before creating their Expense children.
            # Scalar FK IDs without ORM relationships do not guarantee flush order.
            await db.flush()
            for payment_id in payment_ids:
                db.add(Expense(
                    project_id=project_id, payment_id=payment_id, title="Shared invoice",
                    category="works", amount=5000, status="confirmed",
                ))
            await db.commit()

        # Hold exactly the common project lock to make both independent
        # payment writers queue behind it, then release them simultaneously.
        holder_ready = asyncio.Event()
        release_holder = asyncio.Event()

        async def hold_project():
            async with Session() as db:
                assert await lock_project_budget_projection(db, project_id)
                holder_ready.set()
                await asyncio.wait_for(release_holder.wait(), 20)
                await db.commit()

        async def refund(i: int):
            async with Session() as db:
                return await payment_reversal_service.apply_provider_refund(
                    db, yookassa_payment_id=provider_ids[i],
                    refund_id=refund_ids[i], amount=1500 if i == 0 else 2500,
                    currency="RUB", commit=True,
                )

        hold = asyncio.create_task(hold_project())
        try:
            await asyncio.wait_for(holder_ready.wait(), 15)
            first = asyncio.create_task(refund(0))
            second = asyncio.create_task(refund(1))
            await asyncio.sleep(0.25)
        finally:
            release_holder.set()
            await asyncio.wait_for(hold, 20)
        a, b = await asyncio.wait_for(asyncio.gather(first, second), 35)
        assert a.handled and a.changed and b.handled and b.changed

        async with Session() as db:
            project = await db.get(Project, project_id)
            expenses = list((await db.execute(
                select(Expense).where(Expense.project_id == project_id)
            )).scalars().all())
            assert len(expenses) == 2
            assert sorted(round(float(e.amount), 2) for e in expenses) == [2500, 3500]
            assert all(e.status == "confirmed" for e in expenses)
            assert round(float(project.budget_spent), 2) == 6000
            assert sum(round(float(e.amount), 2) for e in expenses) == 6000
            assert await db.scalar(
                select(func.count()).select_from(ProjectPaymentRefund).where(
                    ProjectPaymentRefund.project_id == project_id
                )
            ) == 2
            lines = list((await db.execute(
                select(BudgetLine).where(BudgetLine.project_id == project_id)
            )).scalars().all())
            assert round(sum(float(l.actual_amount or 0) for l in lines), 2) == 6000
    finally:
        async with Session() as db:
            await db.execute(delete(DomainOutbox).where(
                DomainOutbox.aggregate_id.in_(payment_ids)
            ))
            await db.execute(delete(PaymentEvent).where(
                PaymentEvent.payment_id.in_(payment_ids)
            ))
            await db.execute(delete(ProjectPaymentRefund).where(
                ProjectPaymentRefund.payment_id.in_(payment_ids)
            ))
            await db.execute(delete(BudgetLine).where(BudgetLine.project_id == project_id))
            await db.execute(delete(Expense).where(Expense.project_id == project_id))
            await db.execute(delete(Payment).where(Payment.id.in_(payment_ids)))
            await db.execute(delete(Project).where(Project.id == project_id))
            await db.execute(delete(User).where(User.id.in_([customer_id, contractor_id])))
            await db.commit()
        await engine.dispose()
