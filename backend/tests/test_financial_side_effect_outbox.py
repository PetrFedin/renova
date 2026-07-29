from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Expense,
    Payment,
    Project,
    Receipt,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease, SideEffectDelivery
from app.services import activity_service, notification_service, outbox_service
from app.services.client_write_idempotency import commit_client_write
from app.services.payment_service import prepare_payment


@pytest_asyncio.fixture
async def outbox_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db):
    customer = User(id="customer-outbox", phone="+79990000101", role=UserRole.customer)
    contractor = User(id="contractor-outbox", phone="+79990000102", role=UserRole.contractor)
    project = Project(
        id="project-outbox",
        name="Durable side effects",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    return customer, contractor, project


@pytest.mark.asyncio
async def test_payment_push_failure_recovers_without_duplicate_notification(outbox_db, monkeypatch):
    customer, contractor, project = await seed_project(outbox_db)
    payment = await prepare_payment(
        outbox_db,
        project.id,
        contractor.id,
        "Штукатурка",
        125000,
        "stage",
        None,
        None,
    )
    payload = {
        "title": payment.title,
        "amount": payment.amount,
        "payment_type": "stage",
        "stage_id": None,
        "notes": None,
    }
    created, entity_id = await commit_client_write(
        outbox_db,
        scope="payment.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="payment-side-effect-0001",
        payload=payload,
        entity_id=payment.id,
    )
    assert created is True
    assert entity_id == payment.id
    assert (await outbox_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
    assert (await outbox_db.scalar(select(func.count()).select_from(DomainOutboxLease))) == 1

    send_push = AsyncMock(side_effect=[False, True])
    monkeypatch.setattr(notification_service, "send_push", send_push)
    with pytest.raises(RuntimeError, match="push_delivery_failed"):
        await notification_service.notify(
            outbox_db,
            user_id=customer.id,
            project_id=project.id,
            notification_type="payment_pending",
            title=f"Счёт к оплате: {payment.title}",
            body=str(payment.amount),
            link_path="/(customer)/(tabs)/budget?tab=payments",
            return_to="/(customer)/(tabs)/home",
        )

    assert (await outbox_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    delivery = (await outbox_db.execute(select(SideEffectDelivery))).scalar_one()
    assert delivery.delivered_at is None

    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-a") == 1
    assert (await outbox_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert send_push.await_count == 2
    delivery = (await outbox_db.execute(select(SideEffectDelivery))).scalar_one()
    assert delivery.delivered_at is not None
    row = (await outbox_db.execute(select(DomainOutbox))).scalar_one()
    assert row.processed_at is not None

    row.processed_at = None
    lease = await outbox_db.get(DomainOutboxLease, row.id)
    lease.locked_at = None
    lease.locked_by = None
    await outbox_db.commit()
    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-b") == 1
    assert (await outbox_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert send_push.await_count == 2


@pytest.mark.asyncio
async def test_receipt_activity_is_created_once_across_inline_and_worker_delivery(outbox_db):
    customer, _, project = await seed_project(outbox_db)
    receipt = Receipt(
        id="receipt-outbox",
        project_id=project.id,
        amount=2500,
        qr_raw="Доставка",
        fn="MANUAL",
        fns_verified=True,
        expense_category="delivery",
    )
    expense = Expense(
        id="expense-outbox",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Доставка",
        category="delivery",
        amount=2500,
        status="confirmed",
    )
    outbox_db.add_all([receipt, expense])
    await outbox_db.flush()
    payload = {
        "amount": 2500,
        "description": "Доставка",
        "expense_category": "delivery",
        "room_id": None,
        "stage_id": None,
        "payment_id": None,
    }
    created, _ = await commit_client_write(
        outbox_db,
        scope="receipt.manual",
        project_id=project.id,
        user_id=customer.id,
        request_id="receipt-side-effect-0001",
        payload=payload,
        entity_id=receipt.id,
    )
    assert created is True

    await activity_service.log_event(
        outbox_db,
        project_id=project.id,
        user_id=customer.id,
        kind="ExpenseAdded",
        title="Доставка",
        body="2500.0",
        link_path="/(customer)/(tabs)/budget",
    )
    assert (await outbox_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-a") == 1
    assert (await outbox_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1

    row = (await outbox_db.execute(select(DomainOutbox))).scalar_one()
    row.processed_at = None
    lease = await outbox_db.get(DomainOutboxLease, row.id)
    lease.locked_at = None
    lease.locked_by = None
    await outbox_db.commit()
    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-b") == 1
    assert (await outbox_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1


@pytest.mark.asyncio
async def test_failed_outbox_event_is_deferred_instead_of_hot_looping(outbox_db):
    _, contractor, project = await seed_project(outbox_db)
    row = await outbox_service.enqueue(
        outbox_db,
        aggregate_type="test",
        aggregate_id="unknown-aggregate",
        event_type="unknown.event",
        payload={"project_id": project.id, "user_id": contractor.id},
    )
    await outbox_db.commit()

    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-a") == 0
    failed = await outbox_db.get(DomainOutbox, row.id)
    lease = await outbox_db.get(DomainOutboxLease, row.id)
    assert failed.attempts == 1
    assert failed.processed_at is None
    assert "unknown_outbox_event_type" in (failed.last_error or "")
    assert lease.locked_at is None
    assert lease.next_attempt_at is not None

    assert await outbox_service.dispatch_pending(outbox_db, worker_id="worker-b") == 0
    failed = await outbox_db.get(DomainOutbox, row.id)
    assert failed.attempts == 1
