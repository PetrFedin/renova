from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    ChangeOrder,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, notification_service, outbox_service
from app.services.change_order_create_service import prepare_order
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def create_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db):
    customer = User(id="co-create-customer", phone="+79990000401", role=UserRole.customer)
    contractor = User(id="co-create-contractor", phone="+79990000402", role=UserRole.contractor)
    project = Project(
        id="co-create-project",
        name="Idempotent change order create",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    return customer, contractor, project


@pytest.mark.asyncio
async def test_change_order_create_replays_one_entity_and_effects(create_db, monkeypatch):
    customer, contractor, project = await seed_project(create_db)
    payload = {
        "title": "Дополнительная электрика",
        "amount": 42000.0,
        "description": "Шесть дополнительных точек",
    }
    order = await prepare_order(
        create_db,
        project_id=project.id,
        user_id=contractor.id,
        title=payload["title"],
        amount=payload["amount"],
        description=payload["description"],
    )
    created, entity_id = await commit_client_write(
        create_db,
        scope="change_order.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="change-order-create-0001",
        payload=payload,
        entity_id=order.id,
    )
    assert created is True
    assert entity_id == order.id
    assert (await create_db.scalar(select(func.count()).select_from(ChangeOrder))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(ClientWriteRequest))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))
    await activity_service.log_event(
        create_db,
        project_id=project.id,
        user_id=contractor.id,
        kind="ChangeOrderCreated",
        title=f"Доп. работы: {order.title}",
        body=order.description,
        link_path="/(customer)/(tabs)/object?tab=estimate&estimateLayer=changes",
    )
    await notification_service.notify(
        create_db,
        user_id=customer.id,
        project_id=project.id,
        notification_type="change_order",
        title=f"Согласуйте доп. работы: {order.title}",
        body=f"{order.amount:.0f} ₽ · смета → Доп. работы",
        link_path="/(customer)/(tabs)/object?tab=estimate&estimateLayer=changes",
        return_to="/(customer)/(tabs)/",
    )
    clear_request_side_effect_context()

    assert (await create_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert await outbox_service.dispatch_pending(create_db, worker_id="co-create-worker") == 2
    assert (await create_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(AppNotification))) == 1

    replay_id = await replay_entity_id(
        create_db,
        scope="change_order.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="change-order-create-0001",
        payload=payload,
    )
    assert replay_id == order.id
    assert (await create_db.scalar(select(func.count()).select_from(ChangeOrder))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(ClientWriteRequest))) == 1
    assert (await create_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await replay_entity_id(
            create_db,
            scope="change_order.create",
            project_id=project.id,
            user_id=contractor.id,
            request_id="change-order-create-0001",
            payload={**payload, "amount": 43000.0},
        )


@pytest.mark.asyncio
async def test_change_order_request_id_is_user_scoped(create_db):
    customer, contractor, project = await seed_project(create_db)
    payload = {"title": "Работы", "amount": 1000.0, "description": None}
    order = await prepare_order(
        create_db,
        project_id=project.id,
        user_id=contractor.id,
        title=payload["title"],
        amount=payload["amount"],
        description=None,
    )
    await commit_client_write(
        create_db,
        scope="change_order.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="shared-change-order-id",
        payload=payload,
        entity_id=order.id,
    )
    clear_request_side_effect_context()
    assert await replay_entity_id(
        create_db,
        scope="change_order.create",
        project_id=project.id,
        user_id=customer.id,
        request_id="shared-change-order-id",
        payload=payload,
    ) is None
