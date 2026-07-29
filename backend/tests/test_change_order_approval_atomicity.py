from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    BudgetLine,
    ChangeOrder,
    ChangeOrderStatus,
    DomainOutbox,
    Project,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
from app.models.project_documents import DocumentStatus, DocumentVersion, ProjectDocument
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, change_order_service, notification_service, outbox_service
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def change_order_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_order(db, *, order_id: str, status: ChangeOrderStatus = ChangeOrderStatus.pending):
    customer = User(id=f"customer-{order_id}", phone=f"+79991{order_id[-6:]:0>6}", role=UserRole.customer)
    contractor = User(id=f"contractor-{order_id}", phone=f"+78881{order_id[-6:]:0>6}", role=UserRole.contractor)
    project = Project(
        id=f"project-{order_id}",
        name="Atomic change order",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    order = ChangeOrder(
        id=order_id,
        project_id=project.id,
        title="Дополнительная электрика",
        description="Шесть дополнительных точек",
        amount=42000,
        status=status,
        created_by=contractor.id,
    )
    db.add_all([customer, contractor, project, order])
    await db.commit()
    return customer, contractor, project, order


@pytest.mark.asyncio
async def test_approve_commits_budget_document_and_effects_once(change_order_db, monkeypatch):
    customer, contractor, project, order = await seed_order(change_order_db, order_id="co-atomic-0001")
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))

    approved, meta = await change_order_service.approve_with_sign_draft(
        change_order_db,
        project_id=project.id,
        order_id=order.id,
        created_by=customer.id,
    )
    assert approved is not None
    assert approved.status == ChangeOrderStatus.approved
    assert meta is not None and meta["replayed"] is False

    document = await change_order_db.get(ProjectDocument, meta["id"])
    assert document is not None
    assert document.change_order_id == order.id
    assert document.status == DocumentStatus.draft.value
    assert (await change_order_db.scalar(select(func.count()).select_from(ProjectDocument))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(DocumentVersion))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(BudgetLine))) == 1
    stored_project = await change_order_db.get(Project, project.id)
    assert stored_project.budget_planned == order.amount
    assert (await change_order_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4

    await activity_service.log_event(
        change_order_db,
        project_id=project.id,
        user_id=customer.id,
        kind="DocumentDraftForSign",
        title=f"Подпишите доп. работы: {order.title}",
        body=f"Документ {document.id} · {order.amount:.0f} ₽",
        link_path="/documents",
    )
    await activity_service.log_event(
        change_order_db,
        project_id=project.id,
        user_id=customer.id,
        kind="ChangeOrderApproved",
        title=f"Доп. работы согласованы: {order.title}",
        body=str(order.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    await notification_service.notify(
        change_order_db,
        user_id=contractor.id,
        project_id=project.id,
        notification_type="change_order",
        title=f"Доп. работы согласованы: {order.title}",
        body=str(order.amount),
        link_path="/(contractor)/(tabs)/budget",
        return_to="/(contractor)/(tabs)/home",
    )
    await notification_service.notify(
        change_order_db,
        user_id=customer.id,
        project_id=project.id,
        notification_type="document",
        title=f"Подпишите доп. работы: {order.title}",
        body=f"Черновик в Документах · {order.amount:.0f} ₽",
        link_path="/documents",
        return_to="/(customer)/(tabs)/",
    )
    clear_request_side_effect_context()

    assert (await change_order_db.scalar(select(func.count()).select_from(ActivityEvent))) == 2
    assert (await change_order_db.scalar(select(func.count()).select_from(AppNotification))) == 2
    assert await outbox_service.dispatch_pending(change_order_db, worker_id="co-worker") == 4
    assert (await change_order_db.scalar(select(func.count()).select_from(ActivityEvent))) == 2
    assert (await change_order_db.scalar(select(func.count()).select_from(AppNotification))) == 2

    replayed, replay_meta = await change_order_service.approve_with_sign_draft(
        change_order_db,
        project_id=project.id,
        order_id=order.id,
        created_by=customer.id,
    )
    assert replayed is not None
    assert replay_meta is not None and replay_meta["replayed"] is True
    assert replay_meta["id"] == document.id
    assert (await change_order_db.scalar(select(func.count()).select_from(ProjectDocument))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(DocumentVersion))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(BudgetLine))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4
    stored_project = await change_order_db.get(Project, project.id)
    assert stored_project.budget_planned == order.amount


@pytest.mark.asyncio
async def test_approved_row_without_document_is_repaired_once(change_order_db):
    customer, _, project, order = await seed_order(
        change_order_db,
        order_id="co-repair-0001",
        status=ChangeOrderStatus.approved,
    )

    repaired, meta = await change_order_service.approve_with_sign_draft(
        change_order_db,
        project_id=project.id,
        order_id=order.id,
        created_by=customer.id,
    )
    assert repaired is not None
    assert meta is not None and meta["replayed"] is True
    assert (await change_order_db.scalar(select(func.count()).select_from(ProjectDocument))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(BudgetLine))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4

    again, again_meta = await change_order_service.approve_with_sign_draft(
        change_order_db,
        project_id=project.id,
        order_id=order.id,
        created_by=customer.id,
    )
    assert again is not None
    assert again_meta is not None and again_meta["id"] == meta["id"]
    assert (await change_order_db.scalar(select(func.count()).select_from(ProjectDocument))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(BudgetLine))) == 1
    assert (await change_order_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_rejected_order_cannot_be_approved(change_order_db):
    customer, _, project, order = await seed_order(
        change_order_db,
        order_id="co-rejected-0001",
        status=ChangeOrderStatus.rejected,
    )
    approved, meta = await change_order_service.approve_with_sign_draft(
        change_order_db,
        project_id=project.id,
        order_id=order.id,
        created_by=customer.id,
    )
    assert approved is None
    assert meta is None
    assert (await change_order_db.scalar(select(func.count()).select_from(ProjectDocument))) == 0
    assert (await change_order_db.scalar(select(func.count()).select_from(BudgetLine))) == 0
