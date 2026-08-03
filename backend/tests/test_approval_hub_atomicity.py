import json

import pytest
from sqlalchemy import func, select

from app.api.v1 import approvals as approvals_api
from app.models.entities import (
    ChangeOrder,
    ChangeOrderStatus,
    DesignPackage,
    DomainOutbox,
    EstimateLine,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Room,
    RoomChangeRequest,
    RoomChangeStatus,
    User,
    UserRole,
    WasteOrder,
    WasteOrderStatus,
)
from app.services import approval_decision_service as decision_svc
from app.services import design_package_service as design_svc
from app.services import room_change_service as room_change_svc


async def seed_project(db, suffix: str):
    customer = User(
        id=f"approval-customer-{suffix}",
        phone=f"+7901{len(suffix):07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"approval-contractor-{suffix}",
        phone=f"+7902{len(suffix):07d}",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"approval-outsider-{suffix}",
        phone=f"+7903{len(suffix):07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"approval-project-{suffix}",
        name="Approval integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"approval-room-{suffix}",
        project_id=project.id,
        name="Комната",
        room_type="living",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
        outlets_count=0,
        switches_count=0,
        plumbing_points=0,
        notes="Старая заметка",
    )
    db.add_all([customer, contractor, outsider, project, room])
    await db.commit()
    return customer, contractor, outsider, project, room


@pytest.mark.asyncio
async def test_approval_hub_is_role_scoped(db):
    customer, contractor, _, project, room = await seed_project(db, "scope")
    material = MaterialPick(
        project_id=project.id,
        room_id=room.id,
        name="Керамогранит",
        qty=10,
        unit="м²",
        price=2500,
        status=MaterialPickStatus.pending,
    )
    change_order = ChangeOrder(
        project_id=project.id,
        title="Дополнительная электрика",
        amount=15000,
        status=ChangeOrderStatus.pending,
        created_by=contractor.id,
    )
    design = DesignPackage(
        project_id=project.id,
        title="Гостиная",
        version=1,
        status="pending",
    )
    waste = WasteOrder(
        project_id=project.id,
        room_id=room.id,
        volume_m3=2,
        waste_type="construction",
        status=WasteOrderStatus.requested,
    )
    room_request = RoomChangeRequest(
        project_id=project.id,
        room_id=room.id,
        requested_by=customer.id,
        message="Добавить розетки",
        status=RoomChangeStatus.pending,
    )
    db.add_all([material, change_order, design, waste, room_request])
    await db.commit()

    customer_hub = await approvals_api.approval_hub(
        project.id,
        user=customer,
        db=db,
    )
    contractor_hub = await approvals_api.approval_hub(
        project.id,
        user=contractor,
        db=db,
    )

    assert {item["type"] for item in customer_hub["items"]} == {
        "material",
        "change_order",
        "design",
        "waste",
    }
    assert {item["type"] for item in contractor_hub["items"]} == {"room_change"}
    assert all(item["allowed_actions"] == ["approve", "reject"] for item in customer_hub["items"])


@pytest.mark.asyncio
async def test_customer_cannot_resolve_own_room_request_and_executor_applies_patch_atomically(db):
    customer, contractor, _, project, room = await seed_project(db, "room")
    request = RoomChangeRequest(
        project_id=project.id,
        room_id=room.id,
        requested_by=customer.id,
        message="Три розетки и очистить заметку",
        payload_json=json.dumps({"outlets_count": 3, "notes": None}),
        status=RoomChangeStatus.pending,
    )
    db.add(request)
    await db.commit()

    with pytest.raises(ValueError, match="room_change_actor_forbidden"):
        await decision_svc.decide(
            db,
            project=project,
            item_id=request.id,
            item_type="room_change",
            decision="approve",
            actor=customer,
        )

    result = await decision_svc.decide(
        db,
        project=project,
        item_id=request.id,
        item_type="room_change",
        decision="approve",
        actor=contractor,
    )
    assert result is not None
    assert result["status"] == "approved"
    assert result["replayed"] is False
    assert set(result["changes"]) == {"outlets_count", "notes"}

    request_status, resolved_at = (
        await db.execute(
            select(RoomChangeRequest.status, RoomChangeRequest.resolved_at).where(
                RoomChangeRequest.id == request.id
            )
        )
    ).one()
    outlets_count, notes = (
        await db.execute(
            select(Room.outlets_count, Room.notes).where(Room.id == room.id)
        )
    ).one()
    planned_budget = await db.scalar(
        select(Project.budget_planned).where(Project.id == project.id)
    )
    calculated_budget = await db.scalar(
        select(func.sum(EstimateLine.quantity_planned * EstimateLine.unit_price)).where(
            EstimateLine.project_id == project.id
        )
    )
    estimate_count = await db.scalar(
        select(func.count())
        .select_from(EstimateLine)
        .where(
            EstimateLine.room_id == room.id,
            EstimateLine.category == "electrical",
        )
    )
    outbox_count = await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "room_change_request",
            DomainOutbox.aggregate_id == request.id,
        )
    )

    assert request_status == RoomChangeStatus.approved
    assert resolved_at is not None
    assert outlets_count == 3
    assert notes is None
    assert estimate_count == 2
    assert planned_budget == pytest.approx(float(calculated_budget), abs=0.01)
    assert planned_budget > 3150
    assert outbox_count == 2

    replay = await decision_svc.decide(
        db,
        project=project,
        item_id=request.id,
        item_type="room_change",
        decision="approve",
        actor=contractor,
    )
    assert replay is not None
    assert replay["replayed"] is True
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "room_change_request",
            DomainOutbox.aggregate_id == request.id,
        )
    ) == outbox_count


@pytest.mark.asyncio
async def test_forbidden_room_patch_rolls_back_request_and_room(db):
    customer, contractor, _, project, room = await seed_project(db, "invalid-room")
    request = RoomChangeRequest(
        project_id=project.id,
        room_id=room.id,
        requested_by=customer.id,
        message="Попытка изменить связь проекта",
        payload_json=json.dumps({"project_id": "foreign-project"}),
        status=RoomChangeStatus.pending,
    )
    db.add(request)
    await db.commit()
    request_id = request.id
    room_id = room.id
    project_id = project.id

    with pytest.raises(ValueError, match="room_patch_field_forbidden:project_id"):
        await room_change_svc.decide_request(
            db,
            project=project,
            request_id=request_id,
            actor=contractor,
            decision="approve",
        )

    assert await db.scalar(
        select(RoomChangeRequest.status).where(RoomChangeRequest.id == request_id)
    ) == RoomChangeStatus.pending
    assert await db.scalar(select(Room.project_id).where(Room.id == room_id)) == project_id
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == request_id)
    ) == 0


@pytest.mark.asyncio
async def test_design_decision_rolls_back_when_durable_evidence_cannot_be_enqueued(db, monkeypatch):
    customer, _, _, project, _ = await seed_project(db, "design-rollback")
    package = DesignPackage(
        project_id=project.id,
        title="Кухня",
        version=1,
        status="pending",
    )
    db.add(package)
    await db.commit()
    package_id = package.id

    async def fail_effects(*_args, **_kwargs):
        raise RuntimeError("synthetic_outbox_failure")

    monkeypatch.setattr(design_svc, "_prepare_effects", fail_effects)
    with pytest.raises(RuntimeError, match="synthetic_outbox_failure"):
        await design_svc.transition_package(
            db,
            project=project,
            package_id=package_id,
            actor=customer,
            action="approve",
        )

    assert await db.scalar(
        select(DesignPackage.status).where(DesignPackage.id == package_id)
    ) == "pending"
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == package_id)
    ) == 0


@pytest.mark.asyncio
async def test_material_hub_decision_uses_canonical_transition_without_duplicate_effects(db):
    customer, _, _, project, room = await seed_project(db, "material")
    pick = MaterialPick(
        project_id=project.id,
        room_id=room.id,
        name="Краска",
        qty=4,
        unit="л",
        price=1200,
        status=MaterialPickStatus.pending,
    )
    db.add(pick)
    await db.commit()

    first = await decision_svc.decide(
        db,
        project=project,
        item_id=pick.id,
        item_type="material",
        decision="approve",
        actor=customer,
    )
    assert first is not None
    assert first["status"] == "approved"
    assert first["replayed"] is False
    event_count = await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "material_pick",
            DomainOutbox.aggregate_id == pick.id,
        )
    )
    assert event_count == 2

    replay = await decision_svc.decide(
        db,
        project=project,
        item_id=pick.id,
        item_type="material",
        decision="approve",
        actor=customer,
    )
    assert replay is not None
    assert replay["replayed"] is True
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "material_pick",
            DomainOutbox.aggregate_id == pick.id,
        )
    ) == event_count


@pytest.mark.asyncio
async def test_waste_rejection_is_canonical_and_replay_safe(db):
    customer, _, _, project, room = await seed_project(db, "waste")
    order = WasteOrder(
        project_id=project.id,
        room_id=room.id,
        volume_m3=1.5,
        waste_type="construction",
        status=WasteOrderStatus.requested,
    )
    db.add(order)
    await db.commit()

    first = await decision_svc.decide(
        db,
        project=project,
        item_id=order.id,
        item_type="waste",
        decision="reject",
        actor=customer,
        reason="Сначала согласовать дату",
    )
    assert first is not None
    assert first["status"] == "cancelled"
    assert first["replayed"] is False
    event_count = await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "waste_order",
            DomainOutbox.aggregate_id == order.id,
        )
    )
    assert event_count == 2

    replay = await decision_svc.decide(
        db,
        project=project,
        item_id=order.id,
        item_type="waste",
        decision="reject",
        actor=customer,
    )
    assert replay is not None
    assert replay["replayed"] is True
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "waste_order",
            DomainOutbox.aggregate_id == order.id,
        )
    ) == event_count


@pytest.mark.asyncio
async def test_room_request_creation_rejects_foreign_actor_and_unsafe_payload(db):
    customer, _, outsider, project, room = await seed_project(db, "room-create")

    with pytest.raises(ValueError, match="room_change_customer_required"):
        await room_change_svc.create_request(
            db,
            project=project,
            actor=outsider,
            room_id=room.id,
            message="Чужой запрос",
            payload={"outlets_count": 2},
        )

    with pytest.raises(ValueError, match="room_patch_field_forbidden:id"):
        await room_change_svc.create_request(
            db,
            project=project,
            actor=customer,
            room_id=room.id,
            message="Небезопасное поле",
            payload={"id": "replacement"},
        )

    assert await db.scalar(select(func.count()).select_from(RoomChangeRequest)) == 0
