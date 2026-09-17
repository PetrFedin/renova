from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import floor_plans as api
from app.models.entities import (
    FloorPlan,
    FloorPlanPin,
    FurnitureItem,
    Project,
    Room,
    User,
    UserRole,
)


async def seed_two_projects(db):
    customer = User(
        id="floor-scope-customer",
        phone="+78040000001",
        role=UserRole.customer,
    )
    project_a = Project(
        id="floor-scope-project-a",
        name="Floor scope A",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    project_b = Project(
        id="floor-scope-project-b",
        name="Floor scope B",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    room_a = Room(
        id="floor-scope-room-a",
        project_id=project_a.id,
        name="Room A",
        room_type="living",
        length_m=4,
        width_m=3,
    )
    room_b = Room(
        id="floor-scope-room-b",
        project_id=project_b.id,
        name="Room B",
        room_type="living",
        length_m=5,
        width_m=3,
    )
    plan_a = FloorPlan(
        id="floor-scope-plan-a",
        project_id=project_a.id,
        name="Plan A",
        image_key="tests/floor-a.png",
    )
    plan_b = FloorPlan(
        id="floor-scope-plan-b",
        project_id=project_b.id,
        name="Plan B",
        image_key="tests/floor-b.png",
    )
    pin_b = FloorPlanPin(
        id="floor-scope-pin-b",
        floor_plan_id=plan_b.id,
        room_id=room_b.id,
        x_pct=17,
        y_pct=23,
        label="B",
    )
    db.add_all([customer, project_a, project_b, room_a, room_b, plan_a, plan_b, pin_b])
    await db.commit()
    return customer, project_a, project_b, room_a, room_b, plan_a, plan_b, pin_b


def _furniture_body(request_id: str, **kwargs):
    return api.FurnitureCreateIn(client_request_id=request_id, **kwargs)


async def _fresh_user(db, user_id: str) -> User:
    user = await db.get(User, user_id, populate_existing=True)
    assert user is not None
    return user


@pytest.mark.asyncio
async def test_move_pin_cannot_cross_project_or_plan_boundary(db):
    customer, project_a, _, room_a, _, plan_a, _, pin_b = await seed_two_projects(db)
    customer_id, project_a_id = customer.id, project_a.id
    room_a_id, plan_a_id, pin_b_id = room_a.id, plan_a.id, pin_b.id

    with pytest.raises(HTTPException) as captured:
        await api.move_pin(
            project_a_id,
            plan_a_id,
            pin_b_id,
            api.PinPatch(x_pct=88, y_pct=91),
            user=customer,
            db=db,
        )
    assert captured.value.status_code == 404

    foreign_pin = await db.get(FloorPlanPin, pin_b_id)
    assert foreign_pin is not None
    assert foreign_pin.x_pct == 17
    assert foreign_pin.y_pct == 23

    own_pin = await api.upsert_pin(
        project_a_id,
        plan_a_id,
        api.PinIn(room_id=room_a_id, x_pct=20, y_pct=30, label="A"),
        user=await _fresh_user(db, customer_id),
        db=db,
    )
    moved = await api.move_pin(
        project_a_id,
        plan_a_id,
        own_pin["id"],
        api.PinPatch(x_pct=40, y_pct=50),
        user=await _fresh_user(db, customer_id),
        db=db,
    )
    assert moved == {"id": own_pin["id"], "x_pct": 40, "y_pct": 50}


@pytest.mark.asyncio
async def test_pin_room_reference_is_project_scoped(db):
    customer, project_a, _, _, room_b, plan_a, _, _ = await seed_two_projects(db)
    customer_id, project_a_id, room_b_id, plan_a_id = customer.id, project_a.id, room_b.id, plan_a.id

    before = await db.scalar(
        select(func.count())
        .select_from(FloorPlanPin)
        .where(FloorPlanPin.floor_plan_id == plan_a_id)
    )
    with pytest.raises(HTTPException) as captured:
        await api.upsert_pin(
            project_a_id,
            plan_a_id,
            api.PinIn(room_id=room_b_id, x_pct=11, y_pct=22, label="foreign"),
            user=customer,
            db=db,
        )
    assert captured.value.status_code == 404
    after = await db.scalar(
        select(func.count())
        .select_from(FloorPlanPin)
        .where(FloorPlanPin.floor_plan_id == plan_a_id)
    )
    assert after == before


@pytest.mark.asyncio
async def test_furniture_references_are_project_scoped_and_same_project_refs_work(db):
    customer, project_a, _, room_a, room_b, plan_a, plan_b, _ = await seed_two_projects(db)
    customer_id = customer.id
    project_a_id = project_a.id
    room_a_id, room_b_id = room_a.id, room_b.id
    plan_a_id, plan_b_id = plan_a.id, plan_b.id

    with pytest.raises(HTTPException) as foreign_room:
        await api.create_furniture(
            project_a_id,
            _furniture_body(
                "floor-binding-foreign-room",
                room_id=room_b_id,
                name="Foreign room chair",
            ),
            user=customer,
            db=db,
        )
    assert foreign_room.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_plan:
        await api.create_furniture(
            project_a_id,
            _furniture_body(
                "floor-binding-foreign-plan",
                floor_plan_id=plan_b_id,
                name="Foreign plan chair",
            ),
            user=await _fresh_user(db, customer_id),
            db=db,
        )
    assert foreign_plan.value.status_code == 404

    with pytest.raises(HTTPException) as mixed_refs:
        await api.create_furniture(
            project_a_id,
            _furniture_body(
                "floor-binding-mixed-refs",
                room_id=room_a_id,
                floor_plan_id=plan_b_id,
                name="Mixed refs chair",
            ),
            user=await _fresh_user(db, customer_id),
            db=db,
        )
    assert mixed_refs.value.status_code == 404

    assert await db.scalar(
        select(func.count())
        .select_from(FurnitureItem)
        .where(FurnitureItem.project_id == project_a_id)
    ) == 0

    created = await api.create_furniture(
        project_a_id,
        _furniture_body(
            "floor-binding-own-chair",
            room_id=room_a_id,
            floor_plan_id=plan_a_id,
            name="Own chair",
            x_pct=10,
            y_pct=15,
        ),
        user=await _fresh_user(db, customer_id),
        db=db,
    )
    furniture_id = (
        await db.execute(
            select(FurnitureItem.id).where(
                FurnitureItem.project_id == project_a_id,
                FurnitureItem.name == "Own chair",
            )
        )
    ).scalar_one()
    assert created["id"] == furniture_id
    assert created["replayed"] is False

    moved = await api.move_furniture(
        project_a_id,
        furniture_id,
        api.FurnitureMove(x_pct=60, y_pct=70),
        user=await _fresh_user(db, customer_id),
        db=db,
    )
    assert moved == {"ok": True, "x_pct": 60, "y_pct": 70}
