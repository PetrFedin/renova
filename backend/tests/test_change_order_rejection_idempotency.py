from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    ChangeOrder,
    ChangeOrderStatus,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, change_order_service, notification_service, outbox_service
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def rejection_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_rejection_and_delivery_replay_once(rejection_db, monkeypatch):
    customer = User(id="co-reject-customer", phone="+79990000301", role=UserRole.customer)
    contractor = User(id="co-reject-contractor", phone="+79990000302", role=UserRole.contractor)
    project = Project(
        id="co-reject-project",
        name="Reject replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    order = ChangeOrder(
        id="co-reject-order",
        project_id=project.id,
        title="Лишние работы",
        description="Не согласовано",
        amount=15000,
        created_by=contractor.id,
    )
    rejection_db.add_all([customer, contractor, project, order])
    await rejection_db.commit()
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))

    rejected, replayed = await change_order_service.reject_with_effects(
        rejection_db,
        project_id=project.id,
        order_id=order.id,
        rejected_by=customer.id,
    )
    assert rejected is not None
    assert rejected.status == ChangeOrderStatus.rejected
    assert replayed is False
    assert (await rejection_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    await activity_service.log_event(
        rejection_db,
        project_id=project.id,
        user_id=customer.id,
        kind="ChangeOrderRejected",
        title=f"Доп. работы отклонены: {order.title}",
        body=order.description,
        link_path="/(customer)/(tabs)/budget",
    )
    await notification_service.notify(
        rejection_db,
        user_id=contractor.id,
        project_id=project.id,
        notification_type="change_order",
        title=f"Доп. работы отклонены: {order.title}",
        body=order.description or "",
        link_path="/(contractor)/(tabs)/budget",
        return_to="/(contractor)/(tabs)/home",
    )
    clear_request_side_effect_context()

    assert (await rejection_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await rejection_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert await outbox_service.dispatch_pending(rejection_db, worker_id="reject-worker") == 2
    assert (await rejection_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await rejection_db.scalar(select(func.count()).select_from(AppNotification))) == 1

    repeated, replayed = await change_order_service.reject_with_effects(
        rejection_db,
        project_id=project.id,
        order_id=order.id,
        rejected_by=customer.id,
    )
    assert repeated is not None
    assert replayed is True
    assert (await rejection_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2
    assert (await rejection_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await rejection_db.scalar(select(func.count()).select_from(AppNotification))) == 1
