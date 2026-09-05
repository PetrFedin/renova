from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.entities import (
    DomainOutbox,
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkDependency,
)
from app.services import (
    dependency_service,
    material_pick_service,
    material_supply_service,
    outbox_service,
    purchase_service,
)
from app.services.client_write_side_effects import clear_request_side_effect_context
from app.services.purchase_create_service import prepare_purchase_from_picks


def _id() -> str:
    return str(uuid4())


def _user(role: UserRole) -> User:
    return User(
        id=_id(),
        phone=f"+7{uuid4().int % 10_000_000_000:010d}",
        role=role,
    )


async def _project(db, *, with_contractor: bool = True):
    customer = _user(UserRole.customer)
    contractor = _user(UserRole.contractor) if with_contractor else None
    project = Project(
        id=_id(),
        name="Material supply truth",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id if contractor else None,
    )
    db.add(customer)
    if contractor:
        db.add(contractor)
    db.add(project)
    await db.commit()
    return project, customer, contractor


def _pick(
    project: Project,
    *,
    source: str,
    qty: float,
    available: float,
    status: MaterialPickStatus = MaterialPickStatus.approved,
    stage_id: str | None = None,
) -> MaterialPick:
    return MaterialPick(
        id=_id(),
        project_id=project.id,
        stage_id=stage_id,
        name=f"Материал {source} {_id()[:6]}",
        qty=qty,
        qty_needed=qty,
        qty_delivered=0,
        unit="шт",
        price=100,
        status=status,
        supply_source=source,
        qty_available=available,
    )


def test_supply_snapshot_supports_partial_on_hand_before_purchase():
    project = Project(id=_id(), name="P", renovation_type="cosmetic", customer_id=_id())
    pick = _pick(project, source="customer_to_buy", qty=10, available=3)

    supply = material_supply_service.snapshot(pick)

    assert supply.required_qty == 10
    assert supply.qty_available == 3
    assert supply.qty_delivered == 0
    assert supply.qty_to_buy == 7
    assert supply.buy_required is True
    assert supply.is_available is False


def test_customer_on_hand_means_the_full_required_quantity_is_available():
    with pytest.raises(material_supply_service.MaterialSupplyError) as exc_info:
        material_supply_service.validate_supply_truth(
            source="customer_on_hand",
            required_qty=5,
            qty_available=4,
        )

    assert exc_info.value.code == "customer_on_hand_quantity_incomplete"
    assert material_supply_service.validate_supply_truth(
        source="customer_on_hand",
        required_qty=5,
        qty_available=5,
    ) == 5


@pytest.mark.asyncio
async def test_non_purchase_source_cannot_create_fake_purchase(db):
    project, customer, _ = await _project(db)
    pick = _pick(project, source="customer_on_hand", qty=5, available=5)
    db.add(pick)
    await db.commit()

    with pytest.raises(ValueError, match="purchase_pick_not_buy_required"):
        await prepare_purchase_from_picks(
            db,
            project_id=project.id,
            actor=customer,
            pick_ids=[pick.id],
            supplier_name=None,
        )


@pytest.mark.asyncio
async def test_purchase_uses_only_remaining_quantity_and_responsible_actor(db):
    project, customer, contractor = await _project(db)
    pick = _pick(project, source="customer_to_buy", qty=10, available=3)
    db.add(pick)
    await db.commit()

    with pytest.raises(ValueError, match="purchase_pick_responsibility_forbidden"):
        await prepare_purchase_from_picks(
            db,
            project_id=project.id,
            actor=contractor,
            pick_ids=[pick.id],
            supplier_name=None,
        )

    purchase = await prepare_purchase_from_picks(
        db,
        project_id=project.id,
        actor=customer,
        pick_ids=[pick.id],
        supplier_name="Магазин",
    )

    assert len(purchase.items) == 1
    assert purchase.items[0].qty == 7
    assert purchase.total_amount == 700


@pytest.mark.asyncio
async def test_approved_on_hand_material_satisfies_dependency_but_pending_does_not(db):
    project, _, _ = await _project(db, with_contractor=False)
    stage = Stage(
        id=_id(),
        project_id=project.id,
        name="Монтаж",
        status=StageStatus.planned,
    )
    pick = _pick(
        project,
        source="customer_on_hand",
        qty=2,
        available=2,
        status=MaterialPickStatus.pending,
        stage_id=stage.id,
    )
    dependency = WorkDependency(
        id=_id(),
        project_id=project.id,
        stage_id=stage.id,
        depends_on_material_pick_id=pick.id,
        dependency_type="material",
        status="pending",
    )
    db.add_all([stage, pick, dependency])
    await db.commit()

    pending = await dependency_service.evaluate_stage(db, stage, persist_status=True)
    assert pending["blocked"] is True
    assert dependency.status == "pending"

    pick.status = MaterialPickStatus.approved
    await db.commit()
    approved = await dependency_service.evaluate_stage(db, stage, persist_status=True)
    assert approved["blocked"] is False
    assert dependency.status == "satisfied"
    assert stage.status == StageStatus.planned
    assert stage.actual_start is None


@pytest.mark.asyncio
async def test_supply_change_after_approval_requires_reapproval_reblocks_and_is_durable(db):
    project, customer, contractor = await _project(db)
    assert contractor is not None
    stage = Stage(
        id=_id(),
        project_id=project.id,
        name="Покраска",
        status=StageStatus.planned,
    )
    pick = _pick(
        project,
        source="customer_on_hand",
        qty=4,
        available=4,
        status=MaterialPickStatus.approved,
        stage_id=stage.id,
    )
    dependency = WorkDependency(
        id=_id(),
        project_id=project.id,
        stage_id=stage.id,
        depends_on_material_pick_id=pick.id,
        dependency_type="material",
        status="satisfied",
    )
    db.add_all([stage, pick, dependency])
    await db.commit()

    updated, change = await material_pick_service.update_supply_truth(
        db,
        project_id=project.id,
        pick_id=pick.id,
        supply_source="customer_to_buy",
        qty_available=1,
        actor_id=contractor.id,
    )

    assert updated is not None
    assert change is not None and change.requires_reapproval is True
    assert updated.status == MaterialPickStatus.pending
    assert updated.supply_source == "customer_to_buy"
    assert updated.qty_available == 1
    assert dependency.status == "pending"
    assert material_supply_service.snapshot(updated).qty_to_buy == 3

    durable_rows = list(
        (
            await db.execute(
                select(DomainOutbox).where(
                    DomainOutbox.aggregate_type == "material_supply",
                    DomainOutbox.aggregate_id == pick.id,
                )
            )
        ).scalars().all()
    )
    assert {row.event_type for row in durable_rows} == {
        outbox_service.ACTIVITY_EVENT,
        outbox_service.NOTIFICATION_EVENT,
    }
    assert all(row.processed_at is None for row in durable_rows)
    assert any(customer.id in row.payload_json for row in durable_rows)
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_generate_needs_assigns_real_project_procurement_owner(db):
    managed, _, contractor = await _project(db, with_contractor=True)
    self_managed, _, _ = await _project(db, with_contractor=False)
    db.add_all(
        [
            EstimateLine(
                id=_id(),
                project_id=managed.id,
                line_type=LineType.material,
                name="Плитка",
                unit="м2",
                quantity_planned=8,
                unit_price=1200,
            ),
            EstimateLine(
                id=_id(),
                project_id=self_managed.id,
                line_type=LineType.material,
                name="Краска",
                unit="л",
                quantity_planned=5,
                unit_price=700,
            ),
        ]
    )
    await db.commit()

    managed_created = await purchase_service.generate_needs_from_estimate(db, managed.id)
    self_created = await purchase_service.generate_needs_from_estimate(db, self_managed.id)

    assert contractor is not None
    assert managed_created[0].supply_source == "contractor_to_buy"
    assert self_created[0].supply_source == "customer_to_buy"
    assert managed_created[0].qty_available == 0
    assert self_created[0].qty_available == 0
