"""Одобренные доп. работы должны попадать в счёт, а не только в план проекта.

Этапные платежи создаются из ``stage.payment_amount`` при приёмке этапа.
У доп. работ этапа нет, поэтому до этой правки сумма ДО поднимала
``budget_planned``, но не существовало счёта, которым её можно предъявить.
"""
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ChangeOrder,
    ChangeOrderStatus,
    EstimateLine,
    LineType,
    Payment,
    PaymentType,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import change_order_service, notification_service


@pytest_asyncio.fixture
async def billing_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db, *, suffix: str, co_amount: float = 21000, self_managed: bool = False):
    customer = User(id=f"cust-{suffix}", phone=f"+7999{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"contr-{suffix}", phone=f"+7888{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"proj-{suffix}",
        name="Двушка",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=None if self_managed else contractor.id,
    )
    estimate = EstimateLine(
        project_id=project.id,
        line_type=LineType.work,
        name="Работы по смете",
        unit="м2",
        quantity_planned=100,
        unit_price=1000,
    )
    stage = Stage(
        id=f"stage-{suffix}",
        project_id=project.id,
        name="Черновые работы",
        sort_order=0,
        status=StageStatus.active,
        payment_amount=100000,
        weight_coefficient=1.0,
    )
    order = ChangeOrder(
        id=f"co-{suffix}",
        project_id=project.id,
        title="Дополнительные розетки",
        amount=co_amount,
        status=ChangeOrderStatus.pending,
        created_by=contractor.id,
    )
    db.add_all([customer, contractor, project, estimate, stage, order])
    await db.commit()
    return customer, contractor, project, stage, order


async def billable_total(db, project_id: str) -> float:
    """Всё, что вообще может быть предъявлено к оплате по проекту."""
    stages = list(
        (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    )
    payments = list(
        (await db.execute(select(Payment).where(Payment.project_id == project_id))).scalars().all()
    )
    from_stages = sum(float(stage.payment_amount or 0) for stage in stages)
    standalone = sum(float(payment.amount) for payment in payments if payment.stage_id is None)
    return round(from_stages + standalone, 2)


@pytest.mark.asyncio
async def test_approved_change_order_reaches_an_invoice(billing_db, monkeypatch):
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    _, _, project, _, order = await seed(billing_db, suffix="0001")

    await change_order_service.approve_with_sign_draft(
        billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
    )

    stored = await billing_db.get(Project, project.id)
    assert stored.budget_planned == 121000
    assert await billable_total(billing_db, project.id) == 121000, (
        "план вырос на доп. работы, а предъявить их нечем"
    )

    payment = (
        await billing_db.execute(
            select(Payment).where(Payment.change_order_id == order.id)
        )
    ).scalar_one()
    assert payment.payment_type == PaymentType.change_order
    assert payment.amount == 21000
    assert payment.stage_id is None
    assert "Дополнительные розетки" in payment.title


@pytest.mark.asyncio
async def test_repeated_approval_does_not_double_invoice(billing_db, monkeypatch):
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    _, _, project, _, order = await seed(billing_db, suffix="0002")

    for _ in range(3):
        await change_order_service.approve_with_sign_draft(
            billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
        )

    payments = list(
        (
            await billing_db.execute(
                select(Payment).where(Payment.change_order_id == order.id)
            )
        ).scalars().all()
    )
    assert len(payments) == 1
    assert await billable_total(billing_db, project.id) == 121000


@pytest.mark.asyncio
async def test_legacy_approved_order_gets_its_invoice_on_replay(billing_db, monkeypatch):
    """ДО, одобренные до этой правки, счёт получают, а не остаются без него."""
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    _, _, project, _, order = await seed(billing_db, suffix="0003")

    await change_order_service.approve_with_sign_draft(
        billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
    )
    # Имитируем историческое состояние: одобрено, документ есть, счёта нет.
    payment = (
        await billing_db.execute(select(Payment).where(Payment.change_order_id == order.id))
    ).scalar_one()
    await billing_db.delete(payment)
    await billing_db.commit()
    assert await billable_total(billing_db, project.id) == 100000

    await change_order_service.approve_with_sign_draft(
        billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
    )
    assert await billable_total(billing_db, project.id) == 121000


@pytest.mark.asyncio
async def test_self_managed_project_never_invoices_its_owner(billing_db, monkeypatch):
    """Как и этапные платежи: без подрядчика заказчик не выставляет счёт сам себе."""
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    _, _, project, _, order = await seed(billing_db, suffix="0004", self_managed=True)

    await change_order_service.approve_with_sign_draft(
        billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
    )

    payments = list(
        (
            await billing_db.execute(select(Payment).where(Payment.project_id == project.id))
        ).scalars().all()
    )
    assert payments == []


@pytest.mark.asyncio
async def test_zero_amount_change_order_creates_no_invoice(billing_db, monkeypatch):
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    _, _, project, _, order = await seed(billing_db, suffix="0005", co_amount=0)

    await change_order_service.approve_with_sign_draft(
        billing_db, project_id=project.id, order_id=order.id, created_by=project.customer_id
    )

    payments = list(
        (
            await billing_db.execute(select(Payment).where(Payment.project_id == project.id))
        ).scalars().all()
    )
    assert payments == []
