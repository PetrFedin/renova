from __future__ import annotations

import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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


def _postgres_url() -> str:
    value = os.environ.get("FLOOR_OBJECT_BINDING_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("FLOOR_OBJECT_BINDING_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")
    return value


@pytest.mark.asyncio
async def test_floor_object_binding_is_fail_closed_on_postgres():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:12]

    async with Session() as db:
        customer = User(
            id=f"floor-pg-user-{suffix}",
            phone=f"+79{suffix[:9].replace('a', '1').replace('b', '2').replace('c', '3').replace('d', '4').replace('e', '5').replace('f', '6')}",
            role=UserRole.customer,
        )
        project_a = Project(
            id=f"floor-pg-a-{suffix}",
            name="Floor PG A",
            renovation_type="cosmetic",
            customer_id=customer.id,
        )
        project_b = Project(
            id=f"floor-pg-b-{suffix}",
            name="Floor PG B",
            renovation_type="cosmetic",
            customer_id=customer.id,
        )
        room_a = Room(
            id=f"floor-pg-room-a-{suffix}",
            project_id=project_a.id,
            name="Room A",
            room_type="living",
            length_m=4,
            width_m=3,
        )
        room_b = Room(
            id=f"floor-pg-room-b-{suffix}",
            project_id=project_b.id,
            name="Room B",
            room_type="living",
            length_m=5,
            width_m=3,
        )
        plan_a = FloorPlan(
            id=f"floor-pg-plan-a-{suffix}",
            project_id=project_a.id,
            name="Plan A",
            image_key=f"tests/floor-a-{suffix}.png",
        )
        plan_b = FloorPlan(
            id=f"floor-pg-plan-b-{suffix}",
            project_id=project_b.id,
            name="Plan B",
            image_key=f"tests/floor-b-{suffix}.png",
        )
        pin_b = FloorPlanPin(
            id=f"floor-pg-pin-b-{suffix}",
            floor_plan_id=plan_b.id,
            room_id=room_b.id,
            x_pct=17,
            y_pct=23,
            label="B",
        )
        db.add_all([customer, project_a, project_b, room_a, room_b, plan_a, plan_b, pin_b])
        await db.commit()

        with pytest.raises(HTTPException) as foreign_pin:
            await api.move_pin(
                project_a.id,
                plan_a.id,
                pin_b.id,
                api.PinPatch(x_pct=88, y_pct=91),
                user=customer,
                db=db,
            )
        assert foreign_pin.value.status_code == 404
        await db.refresh(pin_b)
        assert (pin_b.x_pct, pin_b.y_pct) == (17, 23)

        with pytest.raises(HTTPException) as foreign_room_pin:
            await api.upsert_pin(
                project_a.id,
                plan_a.id,
                api.PinIn(room_id=room_b.id, x_pct=11, y_pct=22, label="foreign"),
                user=customer,
                db=db,
            )
        assert foreign_room_pin.value.status_code == 404

        with pytest.raises(HTTPException) as foreign_room_furniture:
            await api.create_furniture(
                project_a.id,
                api.FurnitureIn(room_id=room_b.id, name="Foreign room chair"),
                user=customer,
                db=db,
            )
        assert foreign_room_furniture.value.status_code == 404

        with pytest.raises(HTTPException) as foreign_plan_furniture:
            await api.create_furniture(
                project_a.id,
                api.FurnitureIn(floor_plan_id=plan_b.id, name="Foreign plan chair"),
                user=customer,
                db=db,
            )
        assert foreign_plan_furniture.value.status_code == 404

        own_pin = await api.upsert_pin(
            project_a.id,
            plan_a.id,
            api.PinIn(room_id=room_a.id, x_pct=20, y_pct=30, label="own"),
            user=customer,
            db=db,
        )
        moved_pin = await api.move_pin(
            project_a.id,
            plan_a.id,
            own_pin["id"],
            api.PinPatch(x_pct=40, y_pct=50),
            user=customer,
            db=db,
        )
        assert moved_pin["x_pct"] == 40
        assert moved_pin["y_pct"] == 50

        own_furniture = await api.create_furniture(
            project_a.id,
            api.FurnitureIn(
                room_id=room_a.id,
                floor_plan_id=plan_a.id,
                name="Own chair",
                x_pct=10,
                y_pct=15,
            ),
            user=customer,
            db=db,
        )
        furniture = (
            await db.execute(
                select(FurnitureItem).where(FurnitureItem.id == own_furniture["id"])
            )
        ).scalar_one()
        assert furniture.project_id == project_a.id
        assert furniture.room_id == room_a.id
        assert furniture.floor_plan_id == plan_a.id

    await engine.dispose()