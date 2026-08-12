from datetime import date
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    ChatMessage,
    ChatThread,
    DomainOutbox,
    Project,
    User,
    UserRole,
    WorkOrder,
    WorkOrderStatus,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease
from app.services import outbox_inline_dispatch, outbox_service, work_order_service


@pytest_asyncio.fixture
async def work_order_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db):
    customer = User(id="customer-work-order", phone="+79990000301", role=UserRole.customer)
    contractor = User(id="contractor-work-order", phone="+79990000302", role=UserRole.contractor)
    project = Project(
        id="project-work-order",
        name="Work order atomicity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


@pytest.mark.asyncio
async def test_same_title_work_orders_get_distinct_topic_bound_threads(
    work_order_db,
    monkeypatch,
):
    _, contractor, project = await seed_project(work_order_db)
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    first = await work_order_service.create_work_order(
        work_order_db,
        project_id=project.id,
        user_id=contractor.id,
        title="Покраска стен",
        work_type="painting",
    )
    second = await work_order_service.create_work_order(
        work_order_db,
        project_id=project.id,
        user_id=contractor.id,
        title="Покраска стен",
        work_type="painting",
    )

    assert first.id != second.id
    assert first.chat_thread_id != second.chat_thread_id
    threads = list((await work_order_db.execute(select(ChatThread))).scalars().all())
    assert len(threads) == 2
    assert {thread.topic for thread in threads} == {
        f"work:{first.id}",
        f"work:{second.id}",
    }
    assert {thread.title for thread in threads} == {"Работа: Покраска стен"}
    assert await work_order_db.scalar(select(func.count()).select_from(ChatMessage)) == 2
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutbox)) == 2
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2
    assert inline_dispatch.await_count == 2


@pytest.mark.asyncio
async def test_work_order_create_rolls_back_order_thread_and_message_when_effect_prepare_fails(
    work_order_db,
    monkeypatch,
):
    _, contractor, project = await seed_project(work_order_db)
    project_id = project.id
    contractor_id = contractor.id
    monkeypatch.setattr(
        outbox_service,
        "enqueue",
        AsyncMock(side_effect=RuntimeError("work_order_effect_prepare_failed")),
    )

    with pytest.raises(RuntimeError, match="work_order_effect_prepare_failed"):
        await work_order_service.create_work_order(
            work_order_db,
            project_id=project_id,
            user_id=contractor_id,
            title="Штукатурка",
            work_type="plastering",
        )

    assert await work_order_db.scalar(select(func.count()).select_from(WorkOrder)) == 0
    assert await work_order_db.scalar(select(func.count()).select_from(ChatThread)) == 0
    assert await work_order_db.scalar(select(func.count()).select_from(ChatMessage)) == 0
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 0


@pytest.mark.asyncio
async def test_work_order_transition_commits_status_activity_and_notification_together(
    work_order_db,
    monkeypatch,
):
    _, contractor, project = await seed_project(work_order_db)
    work_order = WorkOrder(
        id="work-order-transition",
        project_id=project.id,
        title="Монтаж потолка",
        work_type="ceiling",
        status=WorkOrderStatus.approved,
        created_by=contractor.id,
    )
    work_order_db.add(work_order)
    await work_order_db.commit()
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    result = await work_order_service.transition(
        work_order_db,
        work_order,
        WorkOrderStatus.in_progress.value,
        contractor.id,
        actor_role=UserRole.contractor,
        project=project,
    )

    assert result.status == WorkOrderStatus.in_progress
    assert result.actual_start == date.today()
    event_types = list(
        (
            await work_order_db.execute(
                select(DomainOutbox.event_type).order_by(DomainOutbox.event_type)
            )
        ).scalars().all()
    )
    assert event_types == [
        outbox_service.ACTIVITY_EVENT,
        outbox_service.NOTIFICATION_EVENT,
    ]
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 2
    inline_dispatch.assert_awaited_once_with(
        work_order_db,
        source="work_order.transition",
        limit=10,
    )


@pytest.mark.asyncio
async def test_work_order_transition_rolls_back_status_when_notification_prepare_fails(
    work_order_db,
    monkeypatch,
):
    _, contractor, project = await seed_project(work_order_db)
    project_id = project.id
    contractor_id = contractor.id
    work_order = WorkOrder(
        id="work-order-transition-rollback",
        project_id=project_id,
        title="Монтаж дверей",
        work_type="doors",
        status=WorkOrderStatus.approved,
        created_by=contractor_id,
    )
    work_order_db.add(work_order)
    await work_order_db.commit()
    work_order_id = work_order.id

    original_enqueue = outbox_service.enqueue
    calls = 0

    async def fail_notification_prepare(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("work_order_notification_prepare_failed")
        return await original_enqueue(*args, **kwargs)

    monkeypatch.setattr(outbox_service, "enqueue", fail_notification_prepare)

    with pytest.raises(RuntimeError, match="work_order_notification_prepare_failed"):
        await work_order_service.transition(
            work_order_db,
            work_order,
            WorkOrderStatus.in_progress.value,
            contractor_id,
            actor_role=UserRole.contractor,
            project=project,
        )

    assert (
        await work_order_db.scalar(
            select(WorkOrder.status).where(WorkOrder.id == work_order_id)
        )
        == WorkOrderStatus.approved
    )
    assert await work_order_db.scalar(
        select(WorkOrder.actual_start).where(WorkOrder.id == work_order_id)
    ) is None
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await work_order_db.scalar(select(func.count()).select_from(DomainOutboxLease)) == 0


@pytest.mark.asyncio
async def test_work_order_transition_rejects_stale_prefetched_status(work_order_db):
    _, contractor, project = await seed_project(work_order_db)
    project_id = project.id
    contractor_id = contractor.id
    work_order_id = "work-order-stale-transition"

    current = WorkOrder(
        id=work_order_id,
        project_id=project_id,
        title="Монтаж электрики",
        work_type="electrical",
        status=WorkOrderStatus.cancelled,
        created_by=contractor_id,
    )
    work_order_db.add(current)
    await work_order_db.commit()

    # This represents another request that prefetched the row while it was still
    # approved. The authoritative row has since been cancelled by another actor.
    stale = WorkOrder(
        id=work_order_id,
        project_id=project_id,
        title="Монтаж электрики",
        work_type="electrical",
        status=WorkOrderStatus.approved,
        created_by=contractor_id,
    )

    with pytest.raises(ValueError, match="work_order_stale"):
        await work_order_service.transition(
            work_order_db,
            stale,
            WorkOrderStatus.in_progress.value,
            contractor_id,
            actor_role=UserRole.contractor,
            project=project,
        )

    assert await work_order_db.scalar(
        select(WorkOrder.status).where(WorkOrder.id == work_order_id)
    ) == WorkOrderStatus.cancelled
    assert await work_order_db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == work_order_id)
    ) == 0


@pytest.mark.asyncio
async def test_customer_only_project_can_execute_review_and_accept_own_work(
    work_order_db,
    monkeypatch,
):
    customer = User(id="customer-self-work", phone="+79990000311", role=UserRole.customer)
    project = Project(
        id="project-self-work",
        name="Self managed renovation",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=None,
    )
    work_order = WorkOrder(
        id="work-order-self-managed",
        project_id=project.id,
        title="Покраска комнаты своими силами",
        work_type="painting",
        status=WorkOrderStatus.approved,
        created_by=customer.id,
    )
    work_order_db.add_all([customer, project, work_order])
    await work_order_db.commit()
    inline_dispatch = AsyncMock(return_value=0)
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", inline_dispatch)

    work_order = await work_order_service.transition(
        work_order_db,
        work_order,
        WorkOrderStatus.in_progress.value,
        customer.id,
        actor_role=UserRole.customer,
        project=project,
    )
    work_order = await work_order_service.transition(
        work_order_db,
        work_order,
        WorkOrderStatus.review.value,
        customer.id,
        actor_role=UserRole.customer,
        project=project,
    )
    work_order = await work_order_service.transition(
        work_order_db,
        work_order,
        WorkOrderStatus.done.value,
        customer.id,
        actor_role=UserRole.customer,
        project=project,
    )

    assert work_order.status == WorkOrderStatus.done
    assert work_order.actual_start == date.today()
    assert work_order.actual_end == date.today()
    activity_events = list(
        (
            await work_order_db.execute(
                select(DomainOutbox).where(
                    DomainOutbox.aggregate_id == work_order.id,
                    DomainOutbox.event_type == outbox_service.ACTIVITY_EVENT,
                )
            )
        ).scalars().all()
    )
    assert len(activity_events) == 3
    assert all(event.payload["body"] == "actor_role=customer" for event in activity_events)
    assert inline_dispatch.await_count == 3


@pytest.mark.asyncio
async def test_hybrid_project_customer_executes_only_explicitly_assigned_work(
    work_order_db,
    monkeypatch,
):
    customer, contractor, project = await seed_project(work_order_db)
    assigned_to_customer = WorkOrder(
        id="work-order-hybrid-customer",
        project_id=project.id,
        title="Покраска ниши заказчиком",
        work_type="painting",
        status=WorkOrderStatus.approved,
        assignee_id=customer.id,
        created_by=customer.id,
    )
    unassigned = WorkOrder(
        id="work-order-hybrid-unassigned",
        project_id=project.id,
        title="Монтаж дверей подрядчиком",
        work_type="doors",
        status=WorkOrderStatus.approved,
        created_by=contractor.id,
    )
    assigned_to_contractor = WorkOrder(
        id="work-order-hybrid-contractor",
        project_id=project.id,
        title="Монтаж электрики подрядчиком",
        work_type="electrical",
        status=WorkOrderStatus.approved,
        assignee_id=contractor.id,
        created_by=contractor.id,
    )
    work_order_db.add_all([assigned_to_customer, unassigned, assigned_to_contractor])
    await work_order_db.commit()
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock(return_value=0))

    result = await work_order_service.transition(
        work_order_db,
        assigned_to_customer,
        WorkOrderStatus.in_progress.value,
        customer.id,
        actor_role=UserRole.customer,
        project=project,
    )
    assert result.status == WorkOrderStatus.in_progress

    for contractor_work in (unassigned, assigned_to_contractor):
        with pytest.raises(ValueError, match="work_order_role_forbidden"):
            await work_order_service.transition(
                work_order_db,
                contractor_work,
                WorkOrderStatus.in_progress.value,
                customer.id,
                actor_role=UserRole.customer,
                project=project,
            )
        await work_order_db.rollback()

    assert await work_order_db.scalar(
        select(WorkOrder.status).where(WorkOrder.id == unassigned.id)
    ) == WorkOrderStatus.approved
    assert await work_order_db.scalar(
        select(WorkOrder.status).where(WorkOrder.id == assigned_to_contractor.id)
    ) == WorkOrderStatus.approved
