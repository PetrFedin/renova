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
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, notification_service, outbox_service, purchase_service
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def purchase_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(id=f"purchase-customer-{suffix}", phone=f"+79990{suffix:0>6}", role=UserRole.customer)
    contractor = User(id=f"purchase-contractor-{suffix}", phone=f"+78880{suffix:0>6}", role=UserRole.contractor)
    project = Project(
        id=f"purchase-project-{suffix}",
        name=f"Purchase project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    return customer, contractor, project


async def seed_purchase(
    db,
    *,
    project: Project,
    purchase_id: str,
    status: PurchaseStatus,
    qty: float = 5,
    unit_price: float = 1000,
):
    pick = MaterialPick(
        id=f"pick-{purchase_id}",
        project_id=project.id,
        name="Керамогранит",
        qty=qty,
        qty_needed=qty,
        qty_delivered=0,
        unit="м²",
        price=unit_price,
        status=MaterialPickStatus.approved,
    )
    purchase = Purchase(
        id=purchase_id,
        project_id=project.id,
        supplier_name="Поставщик",
        status=status,
        total_amount=qty * unit_price,
    )
    item = PurchaseItem(
        id=f"item-{purchase_id}",
        purchase=purchase,
        material_pick_id=pick.id,
        name=pick.name,
        qty=qty,
        unit=pick.unit,
        unit_price=unit_price,
    )
    purchase.items = [item]
    db.add_all([pick, purchase])
    await db.commit()
    return pick, purchase


@pytest.mark.asyncio
async def test_wrong_project_id_cannot_mutate_foreign_purchase(purchase_db):
    customer_a, _, project_a = await seed_project(purchase_db, "101")
    _, _, project_b = await seed_project(purchase_db, "102")
    _, foreign_purchase = await seed_purchase(
        purchase_db,
        project=project_b,
        purchase_id="foreign-purchase",
        status=PurchaseStatus.draft,
    )

    result, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project_a.id,
        purchase_id=foreign_purchase.id,
        status=PurchaseStatus.paid,
        actor_id=customer_a.id,
    )
    assert result is None
    assert changed is False
    stored = await purchase_db.get(Purchase, foreign_purchase.id)
    assert stored.status == PurchaseStatus.draft
    assert stored.paid_at is None
    assert (await purchase_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await purchase_db.scalar(select(func.count()).select_from(DomainOutbox))) == 0


@pytest.mark.asyncio
async def test_delivery_replay_updates_inventory_and_fact_once(purchase_db, monkeypatch):
    customer, contractor, project = await seed_project(purchase_db, "201")
    pick, purchase = await seed_purchase(
        purchase_db,
        project=project,
        purchase_id="delivery-purchase",
        status=PurchaseStatus.paid,
        qty=7,
        unit_price=1200,
    )
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))

    delivered, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project.id,
        purchase_id=purchase.id,
        status=PurchaseStatus.delivered,
        actor_id=contractor.id,
    )
    assert delivered is not None
    assert changed is True
    assert delivered.status == PurchaseStatus.delivered
    stored_pick = await purchase_db.get(MaterialPick, pick.id)
    assert stored_pick.status == MaterialPickStatus.purchased
    assert stored_pick.qty_delivered == 7
    assert (await purchase_db.scalar(select(func.count()).select_from(Expense).where(Expense.purchase_id == purchase.id))) == 1
    stored_project = await purchase_db.get(Project, project.id)
    assert stored_project.budget_spent == 8400
    assert (await purchase_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    kind, title, body = purchase_service.purchase_status_event(PurchaseStatus.delivered, 1, 0)
    await activity_service.log_event(
        purchase_db,
        project_id=project.id,
        user_id=contractor.id,
        kind=kind,
        title=title,
        body=body,
        link_path="/(customer)/(tabs)/repair?tab=materials",
    )
    await notification_service.notify(
        purchase_db,
        user_id=customer.id,
        project_id=project.id,
        notification_type="materials",
        title=title,
        body=body or "",
        link_path="/(customer)/(tabs)/repair?tab=materials",
        return_to="/(customer)/(tabs)/home",
    )
    clear_request_side_effect_context()
    assert (await purchase_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await purchase_db.scalar(select(func.count()).select_from(AppNotification))) == 1
    assert await outbox_service.dispatch_pending(purchase_db, worker_id="purchase-worker") == 2
    assert (await purchase_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await purchase_db.scalar(select(func.count()).select_from(AppNotification))) == 1

    replayed, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project.id,
        purchase_id=purchase.id,
        status=PurchaseStatus.delivered,
        actor_id=contractor.id,
    )
    assert replayed is not None
    assert changed is False
    stored_pick = await purchase_db.get(MaterialPick, pick.id)
    assert stored_pick.qty_delivered == 7
    assert (await purchase_db.scalar(select(func.count()).select_from(Expense).where(Expense.purchase_id == purchase.id))) == 1
    assert (await purchase_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2
    stored_project = await purchase_db.get(Project, project.id)
    assert stored_project.budget_spent == 8400


@pytest.mark.asyncio
async def test_return_reverses_delivery_and_budget_once(purchase_db):
    _, contractor, project = await seed_project(purchase_db, "301")
    pick, purchase = await seed_purchase(
        purchase_db,
        project=project,
        purchase_id="return-purchase",
        status=PurchaseStatus.paid,
        qty=3,
        unit_price=2000,
    )
    delivered, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project.id,
        purchase_id=purchase.id,
        status=PurchaseStatus.delivered,
        actor_id=contractor.id,
    )
    assert delivered is not None and changed is True
    clear_request_side_effect_context()

    returned, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project.id,
        purchase_id=purchase.id,
        status=PurchaseStatus.returned,
        actor_id=contractor.id,
    )
    assert returned is not None
    assert changed is True
    assert returned.status == PurchaseStatus.returned
    stored_pick = await purchase_db.get(MaterialPick, pick.id)
    assert stored_pick.status == MaterialPickStatus.approved
    assert stored_pick.qty_delivered == 0
    assert (await purchase_db.scalar(select(func.count()).select_from(Expense).where(Expense.purchase_id == purchase.id))) == 0
    stored_project = await purchase_db.get(Project, project.id)
    assert stored_project.budget_spent == 0
    outbox_count = await purchase_db.scalar(select(func.count()).select_from(DomainOutbox))
    clear_request_side_effect_context()

    replayed, changed = await purchase_service.transition_status(
        purchase_db,
        project_id=project.id,
        purchase_id=purchase.id,
        status=PurchaseStatus.returned,
        actor_id=contractor.id,
    )
    assert replayed is not None
    assert changed is False
    stored_pick = await purchase_db.get(MaterialPick, pick.id)
    assert stored_pick.qty_delivered == 0
    assert (await purchase_db.scalar(select(func.count()).select_from(DomainOutbox))) == outbox_count


@pytest.mark.asyncio
async def test_invalid_backward_and_terminal_transitions_are_blocked(purchase_db):
    _, contractor, project = await seed_project(purchase_db, "401")
    _, purchase = await seed_purchase(
        purchase_db,
        project=project,
        purchase_id="invalid-purchase",
        status=PurchaseStatus.paid,
    )
    with pytest.raises(ValueError, match="purchase_transition_invalid"):
        await purchase_service.transition_status(
            purchase_db,
            project_id=project.id,
            purchase_id=purchase.id,
            status=PurchaseStatus.ordered,
            actor_id=contractor.id,
        )
    stored = await purchase_db.get(Purchase, purchase.id)
    assert stored.status == PurchaseStatus.paid

    stored.status = PurchaseStatus.cancelled
    await purchase_db.commit()
    with pytest.raises(ValueError, match="purchase_transition_terminal"):
        await purchase_service.transition_status(
            purchase_db,
            project_id=project.id,
            purchase_id=purchase.id,
            status=PurchaseStatus.delivered,
            actor_id=contractor.id,
        )
