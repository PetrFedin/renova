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
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Room,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, material_pick_service, notification_service, outbox_service
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def material_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(id=f"material-customer-{suffix}", phone=f"+79991{suffix:0>6}", role=UserRole.customer)
    contractor = User(id=f"material-contractor-{suffix}", phone=f"+78881{suffix:0>6}", role=UserRole.contractor)
    project = Project(
        id=f"material-project-{suffix}",
        name=f"Material project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(id=f"material-room-{suffix}", project_id=project.id, name="Кухня")
    db.add_all([customer, contractor, project, room])
    await db.commit()
    return customer, contractor, project, room


async def seed_pick(db, *, project: Project, room: Room, pick_id: str, status: MaterialPickStatus):
    pick = MaterialPick(
        id=pick_id,
        project_id=project.id,
        room_id=room.id,
        name="Керамогранит",
        qty=4,
        qty_needed=4,
        qty_delivered=0,
        unit="м²",
        price=2500,
        status=status,
    )
    db.add(pick)
    await db.commit()
    return pick


@pytest.mark.asyncio
async def test_wrong_project_cannot_transition_foreign_material(material_db):
    customer_a, _, project_a, _ = await seed_project(material_db, "101")
    _, _, project_b, room_b = await seed_project(material_db, "102")
    foreign = await seed_pick(
        material_db,
        project=project_b,
        room=room_b,
        pick_id="foreign-material-pick",
        status=MaterialPickStatus.draft,
    )

    result, changed, event = await material_pick_service.transition_pick(
        material_db,
        project_id=project_a.id,
        pick_id=foreign.id,
        action="submit",
        actor_id=customer_a.id,
    )
    assert result is None
    assert changed is False
    assert event is None
    stored = await material_db.get(MaterialPick, foreign.id)
    assert stored.status == MaterialPickStatus.draft
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == 0


@pytest.mark.asyncio
async def test_submit_approve_and_reject_are_replay_safe(material_db, monkeypatch):
    customer, contractor, project, room = await seed_project(material_db, "201")
    pick = await seed_pick(
        material_db,
        project=project,
        room=room,
        pick_id="lifecycle-material-pick",
        status=MaterialPickStatus.draft,
    )
    monkeypatch.setattr(notification_service, "send_push", AsyncMock(return_value=True))

    submitted, changed, submit_event = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=pick.id,
        action="submit",
        actor_id=contractor.id,
    )
    assert submitted is not None and changed is True
    assert submitted.status == MaterialPickStatus.pending
    assert submit_event is not None and submit_event.recipient_id == customer.id
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    await activity_service.log_event(
        material_db,
        project_id=project.id,
        user_id=contractor.id,
        kind=submit_event.kind,
        title=submit_event.title,
        body=submit_event.body,
        room_id=pick.room_id,
        work_type=pick.work_type,
        link_path="/(customer)/(tabs)/repair?tab=materials",
    )
    await notification_service.notify(
        material_db,
        user_id=customer.id,
        project_id=project.id,
        notification_type="approval",
        title=submit_event.notification_title or "Материал на согласовании",
        body=submit_event.notification_body or pick.name,
        link_path=submit_event.notification_link,
        return_to="/(customer)/(tabs)/home",
    )
    clear_request_side_effect_context()
    assert await outbox_service.dispatch_pending(material_db, worker_id="material-submit-worker") == 2
    assert (await material_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await material_db.scalar(select(func.count()).select_from(AppNotification))) == 1

    replayed, changed, _ = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=pick.id,
        action="submit",
        actor_id=contractor.id,
    )
    assert replayed is not None and changed is False
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    approved, changed, approve_event = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=pick.id,
        action="approve",
        actor_id=customer.id,
    )
    assert approved is not None and changed is True
    assert approved.status == MaterialPickStatus.approved
    assert approve_event is not None and approve_event.recipient_id == contractor.id
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4
    clear_request_side_effect_context()

    replayed, changed, _ = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=pick.id,
        action="approve",
        actor_id=customer.id,
    )
    assert replayed is not None and changed is False
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4

    revision = await seed_pick(
        material_db,
        project=project,
        room=room,
        pick_id="revision-material-pick",
        status=MaterialPickStatus.pending,
    )
    rejected, changed, reject_event = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=revision.id,
        action="reject",
        actor_id=customer.id,
        reason="Нужен другой цвет",
    )
    assert rejected is not None and changed is True
    assert rejected.status == MaterialPickStatus.draft
    assert reject_event is not None and "другой цвет" in (reject_event.notification_body or "").lower()
    outbox_count = await material_db.scalar(select(func.count()).select_from(DomainOutbox))
    clear_request_side_effect_context()

    replayed, changed, _ = await material_pick_service.transition_pick(
        material_db,
        project_id=project.id,
        pick_id=revision.id,
        action="reject",
        actor_id=customer.id,
        reason="Нужен другой цвет",
    )
    assert replayed is not None and changed is False
    assert (await material_db.scalar(select(func.count()).select_from(DomainOutbox))) == outbox_count


@pytest.mark.asyncio
async def test_invalid_transitions_and_active_purchase_lock(material_db):
    customer, _, project, room = await seed_project(material_db, "301")
    draft = await seed_pick(
        material_db,
        project=project,
        room=room,
        pick_id="invalid-transition-pick",
        status=MaterialPickStatus.draft,
    )
    with pytest.raises(ValueError, match="material_pick_transition_invalid"):
        await material_pick_service.transition_pick(
            material_db,
            project_id=project.id,
            pick_id=draft.id,
            action="approve",
            actor_id=customer.id,
        )
    await material_db.rollback()

    draft.status = MaterialPickStatus.approved
    purchase = Purchase(
        id="material-active-purchase",
        project_id=project.id,
        status=PurchaseStatus.draft,
        total_amount=10000,
    )
    item = PurchaseItem(
        id="material-active-purchase-item",
        purchase=purchase,
        material_pick_id=draft.id,
        name=draft.name,
        qty=4,
        unit=draft.unit,
        unit_price=draft.price,
    )
    purchase.items = [item]
    material_db.add(purchase)
    await material_db.commit()

    with pytest.raises(ValueError, match="material_pick_not_editable"):
        await material_pick_service.require_editable_pick(
            material_db,
            project_id=project.id,
            pick_id=draft.id,
        )
    await material_db.rollback()
    assert await material_pick_service.material_pick_has_active_purchase(
        material_db,
        project_id=project.id,
        pick_id=draft.id,
    )


@pytest.mark.asyncio
async def test_create_request_replays_same_material_and_validates_links(material_db):
    contractor = None
    _, contractor, project, room = await seed_project(material_db, "401")
    payload = {
        "name": "Краска",
        "room_id": room.id,
        "qty": 2.0,
        "unit": "л",
        "price": 1800.0,
        "shop_url": None,
        "shop_name": "Магазин",
        "work_type": "painting",
        "analog_of_id": None,
        "notes": None,
    }
    pick = await material_pick_service.prepare_pick(material_db, project_id=project.id, **payload)
    created, entity_id = await commit_client_write(
        material_db,
        scope="material_pick.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="material-request-401",
        payload=payload,
        entity_id=pick.id,
    )
    assert created is True
    assert entity_id == pick.id
    replay_id = await replay_entity_id(
        material_db,
        scope="material_pick.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="material-request-401",
        payload=payload,
    )
    assert replay_id == pick.id
    assert (await material_db.scalar(select(func.count()).select_from(MaterialPick))) == 1

    with pytest.raises(ValueError, match="material_pick_room_not_found"):
        await material_pick_service.prepare_pick(
            material_db,
            project_id=project.id,
            **{**payload, "room_id": "foreign-room"},
        )
    await material_db.rollback()
