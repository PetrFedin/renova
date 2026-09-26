"""P0 #377: floor-plan/furniture references stay inside the authorized project."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.floor_plans import FurnitureIn, PinPatch, create_furniture, move_pin
from app.models.entities import FloorPlan, FloorPlanPin, FurnitureItem, Project, Room, User, UserRole


async def _fixture_graph(db):
    customer_a = User(id="floor-customer-a", phone="+70000000101", role=UserRole.customer)
    customer_b = User(id="floor-customer-b", phone="+70000000102", role=UserRole.customer)
    project_a = Project(id="floor-project-a", name="Floor A", renovation_type="cosmetic", customer_id=customer_a.id)
    project_b = Project(id="floor-project-b", name="Floor B", renovation_type="cosmetic", customer_id=customer_b.id)
    room_a = Room(id="floor-room-a", project_id=project_a.id, name="Room A", length_m=4, width_m=3, height_m=2.7)
    room_b = Room(id="floor-room-b", project_id=project_b.id, name="Room B", length_m=5, width_m=4, height_m=2.7)
    plan_a = FloorPlan(id="floor-plan-a", project_id=project_a.id, name="Plan A", image_key="plans/a.jpg")
    plan_b = FloorPlan(id="floor-plan-b", project_id=project_b.id, name="Plan B", image_key="plans/b.jpg")
    pin_a = FloorPlanPin(id="floor-pin-a", floor_plan_id=plan_a.id, room_id=room_a.id, x_pct=10, y_pct=20)
    pin_b = FloorPlanPin(id="floor-pin-b", floor_plan_id=plan_b.id, room_id=room_b.id, x_pct=30, y_pct=40)
    db.add_all([customer_a, customer_b, project_a, project_b, room_a, room_b, plan_a, plan_b, pin_a, pin_b])
    await db.commit()
    return customer_a, customer_b, project_a, project_b, room_a, room_b, plan_a, plan_b, pin_a, pin_b


async def _furniture_rows(db):
    return list((await db.execute(select(FurnitureItem))).scalars().all())


@pytest.mark.asyncio
async def test_move_pin_cannot_mutate_foreign_pin_through_authorized_project_path(db):
    customer_a, _, project_a, _, _, _, plan_a, _, _, pin_b = await _fixture_graph(db)

    with pytest.raises(HTTPException) as exc:
        await move_pin(
            project_id=project_a.id,
            plan_id=plan_a.id,
            pin_id=pin_b.id,
            body=PinPatch(x_pct=91, y_pct=92),
            user=customer_a,
            db=db,
        )

    assert exc.value.status_code == 404
    await db.refresh(pin_b)
    assert (pin_b.x_pct, pin_b.y_pct) == (30, 40)


@pytest.mark.asyncio
async def test_move_pin_rejects_foreign_plan_even_if_pin_matches_that_plan(db):
    customer_a, _, project_a, _, _, _, _, plan_b, _, pin_b = await _fixture_graph(db)

    with pytest.raises(HTTPException) as exc:
        await move_pin(
            project_id=project_a.id,
            plan_id=plan_b.id,
            pin_id=pin_b.id,
            body=PinPatch(x_pct=93, y_pct=94),
            user=customer_a,
            db=db,
        )

    assert exc.value.status_code == 404
    await db.refresh(pin_b)
    assert (pin_b.x_pct, pin_b.y_pct) == (30, 40)


@pytest.mark.asyncio
async def test_move_pin_inside_same_project_still_works(db):
    customer_a, _, project_a, _, _, _, plan_a, _, pin_a, _ = await _fixture_graph(db)

    result = await move_pin(
        project_id=project_a.id,
        plan_id=plan_a.id,
        pin_id=pin_a.id,
        body=PinPatch(x_pct=55, y_pct=65),
        user=customer_a,
        db=db,
    )

    assert result == {"id": pin_a.id, "x_pct": 55, "y_pct": 65}
    await db.refresh(pin_a)
    assert (pin_a.x_pct, pin_a.y_pct) == (55, 65)


@pytest.mark.asyncio
async def test_create_furniture_rejects_room_from_another_project_without_insert(db):
    customer_a, _, project_a, _, _, room_b, plan_a, _, _, _ = await _fixture_graph(db)

    with pytest.raises(HTTPException) as exc:
        await create_furniture(
            project_id=project_a.id,
            body=FurnitureIn(room_id=room_b.id, floor_plan_id=plan_a.id, name="Foreign room chair"),
            user=customer_a,
            db=db,
        )

    assert exc.value.status_code == 404
    assert await _furniture_rows(db) == []


@pytest.mark.asyncio
async def test_create_furniture_rejects_floor_plan_from_another_project_without_insert(db):
    customer_a, _, project_a, _, room_a, _, _, plan_b, _, _ = await _fixture_graph(db)

    with pytest.raises(HTTPException) as exc:
        await create_furniture(
            project_id=project_a.id,
            body=FurnitureIn(room_id=room_a.id, floor_plan_id=plan_b.id, name="Foreign plan chair"),
            user=customer_a,
            db=db,
        )

    assert exc.value.status_code == 404
    assert await _furniture_rows(db) == []


@pytest.mark.asyncio
async def test_create_furniture_accepts_same_project_references(db):
    customer_a, _, project_a, _, room_a, _, plan_a, _, _, _ = await _fixture_graph(db)

    result = await create_furniture(
        project_id=project_a.id,
        body=FurnitureIn(room_id=room_a.id, floor_plan_id=plan_a.id, name="Local chair"),
        user=customer_a,
        db=db,
    )

    item = await db.get(FurnitureItem, result["id"])
    assert item is not None
    assert item.project_id == project_a.id
    assert item.room_id == room_a.id
    assert item.floor_plan_id == plan_a.id
