"""Итоговый отчёт не объявляет экономией деньги, которые ещё должны уйти.

``budget_spent`` намеренно считает только ``confirmed`` платежи: перевод без
подтверждающего документа не является доказанным расходом. Для ленты бюджета
это правильно. Но в ``final_report`` та же величина вычиталась из плана и
остаток целиком назывался «Экономия» — вместе с деньгами, которые заказчик уже
перевёл (``paid_unverified``) и с невыставленными счетами (``pending``).
"""
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    EstimateLine,
    LineType,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import report_service


@pytest_asyncio.fixture
async def report_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db, *, suffix: str, payments: list[tuple[float, PaymentStatus]]):
    customer = User(id=f"cust-{suffix}", phone=f"+7999{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"contr-{suffix}", phone=f"+7888{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"proj-{suffix}",
        name="Двушка на Ленина",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    estimate = EstimateLine(
        project_id=project.id,
        line_type=LineType.work,
        name="Работы по смете",
        unit="м2",
        quantity_planned=300,
        unit_price=1000,
    )
    stage = Stage(
        id=f"stage-{suffix}",
        project_id=project.id,
        name="Черновые работы",
        sort_order=0,
        status=StageStatus.done,
        payment_amount=300000,
        weight_coefficient=1.0,
        percent_complete=100,
    )
    db.add_all([customer, contractor, project, estimate, stage])
    for index, (amount, status) in enumerate(payments):
        db.add(
            Payment(
                project_id=project.id,
                stage_id=stage.id,
                payment_type=PaymentType.stage,
                status=status,
                title=f"Оплата {index + 1}",
                amount=amount,
                created_by=customer.id,
            )
        )
    await db.commit()
    db.expunge_all()
    return project


@pytest.mark.asyncio
async def test_transferred_money_is_not_reported_as_a_saving(report_db, monkeypatch):
    """Заказчик перевёл всё; чеки не проверены. Это не экономия."""
    project = await seed(
        report_db,
        suffix="0001",
        payments=[
            (292006, PaymentStatus.paid_unverified),
            (7994, PaymentStatus.confirmed),
        ],
    )

    report = await report_service.final_report(report_db, project.id)

    assert report["budget_planned"] == 300000
    assert report["budget_spent"] == 7994
    assert report["awaiting_verification"] == 292006
    assert report["savings"] == 0, (
        f"отчёт объявил экономией {report['savings']} ₽, "
        "которые заказчик уже перевёл"
    )


@pytest.mark.asyncio
async def test_unpaid_invoices_are_a_debt_not_a_saving(report_db, monkeypatch):
    """Выставленный, но не оплаченный счёт — долг, а не сэкономленные деньги."""
    project = await seed(
        report_db,
        suffix="0002",
        payments=[(100000, PaymentStatus.confirmed), (200000, PaymentStatus.pending)],
    )

    report = await report_service.final_report(report_db, project.id)

    assert report["budget_spent"] == 100000
    assert report["outstanding"] == 200000
    assert report["savings"] == 0, (
        f"отчёт объявил экономией {report['savings']} ₽ по неоплаченным счетам"
    )


@pytest.mark.asyncio
async def test_a_real_saving_is_still_reported(report_db, monkeypatch):
    """Правка не съедает настоящую экономию: работы закрыты дешевле плана."""
    project = await seed(
        report_db,
        suffix="0003",
        payments=[(250000, PaymentStatus.confirmed)],
    )

    report = await report_service.final_report(report_db, project.id)

    assert report["budget_spent"] == 250000
    assert report["awaiting_verification"] == 0
    assert report["outstanding"] == 0
    assert report["savings"] == 50000


@pytest.mark.asyncio
async def test_cancelled_invoice_does_not_hold_back_the_saving(report_db, monkeypatch):
    """Отменённый счёт никому ничего не должен и экономию не блокирует."""
    project = await seed(
        report_db,
        suffix="0004",
        payments=[(250000, PaymentStatus.confirmed), (50000, PaymentStatus.cancelled)],
    )

    report = await report_service.final_report(report_db, project.id)

    assert report["outstanding"] == 0
    assert report["savings"] == 50000


@pytest.mark.asyncio
async def test_overrun_is_unaffected(report_db, monkeypatch):
    """Перерасход считается по подтверждённым деньгам, как и раньше."""
    project = await seed(
        report_db,
        suffix="0005",
        payments=[(340000, PaymentStatus.confirmed)],
    )

    report = await report_service.final_report(report_db, project.id)

    assert report["overrun"] == 40000
    assert report["savings"] == 0
