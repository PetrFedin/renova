from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    DomainOutbox,
    Project,
    User,
    UserRole,
    WasteOrder,
    WasteOrderStatus,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.services import outbox_inline_dispatch, waste_order_service


@pytest_asyncio.fixture
async def waste_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_order(
    db,
    *,
    status: WasteOrderStatus = WasteOrderStatus.draft,
):
    customer = User(
        id="customer-waste",
        phone="+79990000601",
        role=UserRole.customer,
    )
    contractor = User(
        id="contractor-waste",
        phone="+79990000602",
        role=UserRole.contractor,
    )
    outsider = User(
        id="outsider-waste",
        phone="+79990000603",
        role=UserRole.contractor,
    )
    project = Project(
        id="project-waste",
        name="Waste lifecycle",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    order = WasteOrder(
        id="waste-order",
        project_id=project.id,
        volume_m3=2.5,
        waste_type="construction",
        status=status,
        price=3500,
        notes="После демонтажа",
    )
    db.add_all([customer, contractor, outsider, project, order])
    await db.commit()
    return customer, contractor, outsider, project, order


def test_waste_transition_matrix_blocks_skips_and_wrong_roles():
    project = Project(
        id="matrix-project",
        name="Matrix",
        renovation_type="cosmetic",
        customer_id="customer",
        contractor_id="contractor",
    )
    customer = User(id="customer", phone="+79990000611", role=UserRole.customer)
    contractor = User(id="contractor", phone="+79990000612", role=UserRole.contractor)

    waste_order_service.validate_transition(
        project=project,
        actor=contractor,
        current=WasteOrderStatus.draft,
        target=WasteOrderStatus.requested,
    )
    waste_order_service.validate_transition(
        project=project,
        actor=customer,
        current=WasteOrderStatus.requested,
        target=WasteOrderStatus.scheduled,
    )
    waste_order_service.validate_transition(
        project=project,
        actor=contractor,
        current=WasteOrderStatus.scheduled,
        target=WasteOrderStatus.done,
    )

    with pytest.raises(ValueError, match="invalid_waste_order_transition"):
        waste_order_service.validate_transition(
            project=project,
            actor=customer,
            current=WasteOrderStatus.draft,
            target=WasteOrderStatus.scheduled,
        )
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        waste_order_service.validate_transition(
            project=project,
            actor=customer,
            current=WasteOrderStatus.draft,
            target=WasteOrderStatus.requested,
        )
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        waste_order_service.validate_transition(
            project=project,
            actor=contractor,
            current=WasteOrderStatus.requested,
            target=WasteOrderStatus.scheduled,
        )


@pytest.mark.asyncio
async def test_request_is_atomic_and_replay_does_not_duplicate_effects(
    waste_db,
    monkeypatch,
):
    _, contractor, _, project, order = await seed_order(waste_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    result, replayed = await waste_order_service.transition_order(
        waste_db,
        project=project,
        order_id=order.id,
        actor=contractor,
        target=WasteOrderStatus.requested,
    )

    assert result is not None
    assert result.status == WasteOrderStatus.requested
    assert replayed is False
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2

    replay, replayed = await waste_order_service.transition_order(
        waste_db,
        project=project,
        order_id=order.id,
        actor=contractor,
        target=WasteOrderStatus.requested,
    )

    assert replay is not None
    assert replayed is True
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2
    inline_dispatch.assert_awaited_once_with(
        waste_db,
        source="waste_order.requested",
        limit=10,
    )


@pytest.mark.asyncio
async def test_waste_order_runs_only_through_request_approve_complete(
    waste_db,
    monkeypatch,
):
    customer, contractor, _, project, order = await seed_order(waste_db)
    monkeypatch.setattr(
        outbox_inline_dispatch,
        "dispatch_best_effort",
        AsyncMock(return_value=0),
    )

    await waste_order_service.transition_order(
        waste_db,
        project=project,
        order_id=order.id,
        actor=contractor,
        target=WasteOrderStatus.requested,
    )
    await waste_order_service.transition_order(
        waste_db,
        project=project,
        order_id=order.id,
        actor=customer,
        target=WasteOrderStatus.scheduled,
    )
    result, replayed = await waste_order_service.transition_order(
        waste_db,
        project=project,
        order_id=order.id,
        actor=contractor,
        target=WasteOrderStatus.done,
    )

    assert result is not None
    assert result.status == WasteOrderStatus.done
    assert replayed is False
    event_types = list(
        (
            await waste_db.execute(
                select(DomainOutbox.event_type).order_by(
                    DomainOutbox.created_at,
                    DomainOutbox.event_type,
                )
            )
        ).scalars().all()
    )
    assert event_types.count("activity.created") == 3
    assert event_types.count("notification.created") == 3
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 6


@pytest.mark.asyncio
async def test_transition_rolls_back_status_and_effects_when_prepare_fails(
    waste_db,
    monkeypatch,
):
    customer, _, _, project, order = await seed_order(
        waste_db,
        status=WasteOrderStatus.requested,
    )
    project_id = project.id
    order_id = order.id
    monkeypatch.setattr(
        waste_order_service,
        "_prepare_effects",
        AsyncMock(side_effect=RuntimeError("waste_effect_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="waste_effect_prepare_failed"):
        await waste_order_service.transition_order(
            waste_db,
            project=project,
            order_id=order_id,
            actor=customer,
            target=WasteOrderStatus.scheduled,
        )

    assert await waste_db.scalar(
        select(WasteOrder.status).where(WasteOrder.id == order_id)
    ) == WasteOrderStatus.requested
    assert await waste_db.get(Project, project_id) is not None
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 0


@pytest.mark.asyncio
async def test_unassigned_contractor_cannot_request_or_complete(
    waste_db,
):
    _, _, outsider, project, order = await seed_order(waste_db)

    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        await waste_order_service.transition_order(
            waste_db,
            project=project,
            order_id=order.id,
            actor=outsider,
            target=WasteOrderStatus.requested,
        )

    assert await waste_db.scalar(
        select(WasteOrder.status).where(WasteOrder.id == order.id)
    ) == WasteOrderStatus.draft
    assert await waste_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
