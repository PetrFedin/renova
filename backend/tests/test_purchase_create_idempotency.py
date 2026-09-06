from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
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
from app.services import activity_service, outbox_service
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.client_write_side_effects import (
    PreparedSideEffect,
    activate_client_write_side_effects,
    clear_request_side_effect_context,
)
from app.services.purchase_create_service import prepare_purchase_from_picks


@pytest_asyncio.fixture
async def purchase_create_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project_and_picks(db):
    customer = User(id="purchase-create-customer", phone="+79990000501", role=UserRole.customer)
    contractor = User(id="purchase-create-contractor", phone="+79990000502", role=UserRole.contractor)
    project = Project(
        id="purchase-create-project",
        name="Purchase create",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    picks = [
        MaterialPick(
            id="purchase-create-pick-a",
            project_id=project.id,
            name="Керамогранит",
            qty=10,
            qty_needed=10,
            unit="м²",
            price=2500,
            status=MaterialPickStatus.approved,
        ),
        MaterialPick(
            id="purchase-create-pick-b",
            project_id=project.id,
            name="Клей",
            qty=3,
            qty_needed=3,
            unit="шт",
            price=1200,
            status=MaterialPickStatus.approved,
        ),
    ]
    db.add_all([customer, contractor, project, *picks])
    await db.flush()
    return customer, contractor, project, picks


@pytest.mark.asyncio
async def test_purchase_create_replays_one_order_and_activity(purchase_create_db, monkeypatch):
    _, contractor, project, picks = await seed_project_and_picks(purchase_create_db)
    payload = {
        "material_pick_ids": sorted(pick.id for pick in picks),
        "supplier_name": "Поставщик",
    }
    purchase = await prepare_purchase_from_picks(
        purchase_create_db,
        project_id=project.id,
        actor=contractor,
        pick_ids=payload["material_pick_ids"],
        supplier_name=payload["supplier_name"],
    )
    activity_row = await outbox_service.enqueue(
        purchase_create_db,
        aggregate_type="purchase",
        aggregate_id=purchase.id,
        event_type=outbox_service.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project.id,
            "user_id": contractor.id,
            "kind": "MaterialOrdered",
            "title": "Закупка создана: 2 поз.",
            "body": purchase.supplier_name,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    created, entity_id = await commit_client_write(
        purchase_create_db,
        scope="purchase.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="purchase-create-request-0001",
        payload=payload,
        entity_id=purchase.id,
    )
    assert created is True
    assert entity_id == purchase.id
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 1
    assert (await purchase_create_db.scalar(select(func.count()).select_from(PurchaseItem))) == 2
    assert (await purchase_create_db.scalar(select(func.count()).select_from(ClientWriteRequest))) == 1
    assert (await purchase_create_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    activate_client_write_side_effects(
        [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]
    )
    await activity_service.log_event(
        purchase_create_db,
        project_id=project.id,
        user_id=contractor.id,
        kind="MaterialOrdered",
        title="Закупка создана: 2 поз.",
        body=purchase.supplier_name,
        link_path="/(customer)/(tabs)/repair?tab=materials",
    )
    clear_request_side_effect_context()
    assert (await purchase_create_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert await outbox_service.dispatch_pending(purchase_create_db, worker_id="purchase-create-worker") == 1
    assert (await purchase_create_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1

    replay_id = await replay_entity_id(
        purchase_create_db,
        scope="purchase.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="purchase-create-request-0001",
        payload=payload,
    )
    assert replay_id == purchase.id
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 1
    assert (await purchase_create_db.scalar(select(func.count()).select_from(PurchaseItem))) == 2
    assert (await purchase_create_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await replay_entity_id(
            purchase_create_db,
            scope="purchase.create",
            project_id=project.id,
            user_id=contractor.id,
            request_id="purchase-create-request-0001",
            payload={**payload, "supplier_name": "Другой поставщик"},
        )


@pytest.mark.asyncio
async def test_active_purchase_blocks_new_request_but_cancelled_releases_picks(purchase_create_db):
    _, contractor, project, picks = await seed_project_and_picks(purchase_create_db)
    project_id = project.id
    contractor_id = contractor.id
    pick_ids = [pick.id for pick in picks]
    first = await prepare_purchase_from_picks(
        purchase_create_db,
        project_id=project_id,
        actor=contractor,
        pick_ids=pick_ids,
        supplier_name="Первый",
    )
    first_id = first.id
    await purchase_create_db.commit()

    with pytest.raises(ValueError, match="picks_already_in_active_purchase"):
        await prepare_purchase_from_picks(
            purchase_create_db,
            project_id=project_id,
            actor=contractor,
            pick_ids=pick_ids,
            supplier_name="Второй",
        )
    await purchase_create_db.rollback()
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 1

    stored = await purchase_create_db.get(Purchase, first_id)
    stored.status = PurchaseStatus.cancelled
    await purchase_create_db.commit()
    contractor = await purchase_create_db.get(User, contractor_id)
    assert contractor is not None
    replacement = await prepare_purchase_from_picks(
        purchase_create_db,
        project_id=project_id,
        actor=contractor,
        pick_ids=pick_ids,
        supplier_name="Повторный заказ",
    )
    await purchase_create_db.commit()
    assert replacement.id != first_id
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 2
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_foreign_or_unapproved_pick_rejects_entire_purchase(purchase_create_db):
    _, contractor, project, picks = await seed_project_and_picks(purchase_create_db)
    project_id = project.id
    local_pick_id = picks[0].id
    foreign_customer = User(id="foreign-customer", phone="+79990000503", role=UserRole.customer)
    foreign_project = Project(
        id="foreign-purchase-project",
        name="Foreign",
        renovation_type="cosmetic",
        customer_id=foreign_customer.id,
    )
    foreign_pick = MaterialPick(
        id="foreign-purchase-pick",
        project_id=foreign_project.id,
        name="Чужой материал",
        qty=1,
        qty_needed=1,
        unit="шт",
        price=100,
        status=MaterialPickStatus.approved,
    )
    foreign_pick_id = foreign_pick.id
    purchase_create_db.add_all([foreign_customer, foreign_project, foreign_pick])
    await purchase_create_db.commit()

    with pytest.raises(ValueError, match="purchase_picks_not_found"):
        await prepare_purchase_from_picks(
            purchase_create_db,
            project_id=project_id,
            actor=contractor,
            pick_ids=[local_pick_id, foreign_pick_id],
            supplier_name=None,
        )
    await purchase_create_db.rollback()
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 0

    local_pick = await purchase_create_db.get(MaterialPick, local_pick_id)
    local_pick.status = MaterialPickStatus.pending
    await purchase_create_db.commit()
    with pytest.raises(ValueError, match="picks_not_approved"):
        await prepare_purchase_from_picks(
            purchase_create_db,
            project_id=project_id,
            actor=contractor,
            pick_ids=[local_pick_id],
            supplier_name=None,
        )
    await purchase_create_db.rollback()
    assert (await purchase_create_db.scalar(select(func.count()).select_from(Purchase))) == 0