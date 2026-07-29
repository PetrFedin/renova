from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Expense,
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    Receipt,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, notification_service, payment_service
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def transition_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_payment(db, *, payment_id: str, amount: float = 50000) -> tuple[Project, Payment]:
    customer = User(id=f"customer-{payment_id}", phone=f"+7999{payment_id[-7:]:0>7}", role=UserRole.customer)
    contractor = User(id=f"contractor-{payment_id}", phone=f"+7888{payment_id[-7:]:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"project-{payment_id}",
        name="Payment transition",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    payment = Payment(
        id=payment_id,
        project_id=project.id,
        payment_type=PaymentType.advance,
        status=PaymentStatus.pending,
        title="Аванс",
        amount=amount,
        created_by=contractor.id,
    )
    db.add_all([customer, contractor, project, payment])
    await db.commit()
    return project, payment


@pytest.mark.asyncio
async def test_transfer_ack_replay_has_one_audit_and_no_duplicate_side_effects(transition_db, monkeypatch):
    project, payment = await seed_payment(transition_db, payment_id="pay-ack-0001")
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))

    first = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
        transfer_ack=True,
    )
    assert first is not None
    assert first.status == PaymentStatus.paid_unverified
    assert (await transition_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await transition_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    await activity_service.log_event(
        transition_db,
        project_id=project.id,
        user_id=project.customer_id,
        kind="PaymentApproved",
        title=f"Оплата: {payment.title}",
        body=str(payment.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    await notification_service.notify(
        transition_db,
        user_id=project.contractor_id,
        project_id=project.id,
        notification_type="payment_pending",
        title=f"Перевод отмечен (без чека): {payment.title}",
        body=str(payment.amount),
        link_path="/(contractor)/(tabs)/budget",
        return_to="/(contractor)/(tabs)/home",
    )
    assert (await transition_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(AppNotification))) == 1

    second = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
        transfer_ack=True,
    )
    assert second is not None
    assert second.status == PaymentStatus.paid_unverified
    await activity_service.log_event(
        transition_db,
        project_id=project.id,
        user_id=project.customer_id,
        kind="PaymentApproved",
        title=f"Оплата: {payment.title}",
        body=str(payment.amount),
    )
    await notification_service.notify(
        transition_db,
        user_id=project.contractor_id,
        project_id=project.id,
        notification_type="payment_pending",
        title=f"Перевод отмечен (без чека): {payment.title}",
        body=str(payment.amount),
    )
    assert (await transition_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_confirmed_replay_has_one_expense_and_exact_budget_fact(transition_db):
    project, payment = await seed_payment(transition_db, payment_id="pay-confirm-0001", amount=72000)
    transition_db.add(
        Receipt(
            id="receipt-confirm-0001",
            project_id=project.id,
            payment_id=payment.id,
            amount=payment.amount,
            qr_raw="linked receipt",
            fn="MANUAL",
            fns_verified=True,
            expense_category="materials",
        )
    )
    await transition_db.commit()

    first = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
    )
    assert first is not None
    assert first.status == PaymentStatus.confirmed
    assert (await transition_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(Expense).where(Expense.payment_id == payment.id))) == 1
    stored_project = await transition_db.get(Project, project.id)
    assert stored_project.budget_spent == payment.amount
    outbox_count = await transition_db.scalar(select(func.count()).select_from(DomainOutbox))

    clear_request_side_effect_context()
    second = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
    )
    assert second is not None
    assert second.status == PaymentStatus.confirmed
    assert (await transition_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(Expense).where(Expense.payment_id == payment.id))) == 1
    assert (await transition_db.scalar(select(func.count()).select_from(DomainOutbox))) == outbox_count
    stored_project = await transition_db.get(Project, project.id)
    assert stored_project.budget_spent == payment.amount
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_paid_unverified_can_upgrade_once_to_confirmed(transition_db):
    project, payment = await seed_payment(transition_db, payment_id="pay-upgrade-0001", amount=33000)
    acknowledged = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
        transfer_ack=True,
    )
    assert acknowledged is not None
    assert acknowledged.status == PaymentStatus.paid_unverified
    clear_request_side_effect_context()

    transition_db.add(
        Receipt(
            id="receipt-upgrade-0001",
            project_id=project.id,
            payment_id=payment.id,
            amount=payment.amount,
            qr_raw="linked receipt",
            fn="MANUAL",
            fns_verified=True,
            expense_category="materials",
        )
    )
    await transition_db.commit()
    confirmed = await payment_service.confirm_payment(
        transition_db,
        payment.id,
        project_id=project.id,
    )
    assert confirmed is not None
    assert confirmed.status == PaymentStatus.confirmed
    events = list((await transition_db.execute(select(PaymentEvent).order_by(PaymentEvent.created_at))).scalars().all())
    assert [event.new_status for event in events] == ["paid_unverified", "confirmed"]
    assert (await transition_db.scalar(select(func.count()).select_from(Expense).where(Expense.payment_id == payment.id))) == 1
    stored_project = await transition_db.get(Project, project.id)
    assert stored_project.budget_spent == payment.amount
    clear_request_side_effect_context()
