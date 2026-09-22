"""Ошибочно загруженный план этажа можно убрать.

Найдено разбором полноты жизненного цикла сущностей: во всём
`app/api/v1/floor_plans.py` не было ни одного `@router.delete`. Ни план, ни
пин, ни предмет мебели удалить было невозможно — ошибочно загруженный
чертёж оставался на объекте навсегда.

Главное решение здесь — что делать со связанными записями.

Пин — это точка **на плане**; без плана он ничего не значит и уходит
вместе с ним. Мебель принадлежит объекту и комнате, а на плане лишь
размещена: удалять её вместе с планом значило бы стирать данные, которые
человек вводил отдельно. Поэтому мебель открепляется, а не удаляется.
"""
import pathlib

import pytest

from app.models.entities import (
    FloorPlan,
    FloorPlanPin,
    FurnitureItem,
    Project,
    Room,
    User,
    UserRole,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTES = (ROOT / "app" / "api" / "v1" / "floor_plans.py").read_text()


async def _seed(db, project_id: str = "p1"):
    user = User(id="u1", phone="+70000000001", role=UserRole.customer, full_name="Заказчик")
    db.add(user)
    db.add(Project(id=project_id, name="Объект", customer_id="u1", renovation_type="cosmetic"))
    room = Room(project_id=project_id, name="Кухня", length_m=4.0, width_m=3.0)
    plan = FloorPlan(project_id=project_id, name="Этаж 1", image_key="plans/a.png")
    db.add_all([room, plan])
    await db.flush()
    pin = FloorPlanPin(floor_plan_id=plan.id, room_id=room.id, x_pct=40, y_pct=60)
    item = FurnitureItem(
        project_id=project_id,
        room_id=room.id,
        floor_plan_id=plan.id,
        name="Диван",
        x_pct=20,
        y_pct=30,
    )
    db.add_all([pin, item])
    await db.flush()
    await db.commit()
    return user, plan, pin, item


def _block(name: str) -> str:
    return ROUTES.split(name)[1].split("@router.")[0]


@pytest.mark.asyncio
async def test_plan_removal_keeps_furniture_and_drops_pins(db):
    """Зовём сам маршрут, а не повторяем его логику в тесте."""
    from app.api.v1.floor_plans import delete_floor_plan

    user, plan, pin, item = await _seed(db)

    result = await delete_floor_plan("p1", plan.id, user=user, db=db)
    assert result["ok"] is True
    assert result["pins_removed"] == 1
    assert result["furniture_detached"] == 1

    assert await db.get(FloorPlan, plan.id) is None
    assert await db.get(FloorPlanPin, pin.id) is None, "пин пережил свой план"
    survivor = await db.get(FurnitureItem, item.id)
    assert survivor is not None, "мебель удалили вместе с планом"
    assert survivor.floor_plan_id is None
    assert survivor.x_pct is None and survivor.y_pct is None
    assert survivor.name == "Диван"
    assert survivor.room_id is not None, "мебель потеряла комнату"


def test_three_deletes_exist():
    assert '@router.delete("/{project_id}/floor-plans/{plan_id}")' in ROUTES
    assert '@router.delete("/{project_id}/floor-plans/{plan_id}/pins/{pin_id}")' in ROUTES
    assert '@router.delete("/{project_id}/furniture/{item_id}")' in ROUTES


def test_plan_delete_is_bound_to_the_path_project():
    block = _block('@router.delete("/{project_id}/floor-plans/{plan_id}")')
    assert "plan.project_id != project_id" in block


def test_pin_delete_is_bound_to_the_plan_and_project():
    block = _block('@router.delete("/{project_id}/floor-plans/{plan_id}/pins/{pin_id}")')
    # Без сверки с планом снять можно было бы чужой пин, зная идентификатор.
    assert "pin.floor_plan_id != plan_id" in block
    assert "plan.project_id != project_id" in block


def test_furniture_delete_is_bound_to_the_path_project():
    block = _block('@router.delete("/{project_id}/furniture/{item_id}")')
    assert "item.project_id != project_id" in block


def test_furniture_is_detached_not_destroyed():
    block = _block('@router.delete("/{project_id}/floor-plans/{plan_id}")')
    assert "item.floor_plan_id = None" in block
    assert "await db.delete(item)" not in block, "мебель удаляется вместе с планом"


def test_answer_says_what_happened_to_the_links():
    # Молчаливое «ok» не сказало бы, что пины исчезли, а мебель открепилась.
    block = _block('@router.delete("/{project_id}/floor-plans/{plan_id}")')
    assert '"pins_removed"' in block
    assert '"furniture_detached"' in block


def test_existing_routes_are_unchanged():
    # Проверка не должна проходить оттого, что сломалось создание.
    assert '@router.post("/{project_id}/floor-plans")' in ROUTES
    assert '@router.post("/{project_id}/floor-plans/{plan_id}/pins")' in ROUTES
    assert '@router.post("/{project_id}/furniture")' in ROUTES


@pytest.mark.asyncio
async def test_plan_of_another_project_is_not_removed(db):
    from fastapi import HTTPException

    from app.api.v1.floor_plans import delete_floor_plan

    user, plan, _, _ = await _seed(db)
    db.add(Project(id="p2", name="Чужой", customer_id="u1", renovation_type="cosmetic"))
    await db.commit()

    with pytest.raises(HTTPException) as error:
        await delete_floor_plan("p2", plan.id, user=user, db=db)
    assert error.value.status_code == 404
    assert await db.get(FloorPlan, plan.id) is not None


@pytest.mark.asyncio
async def test_pin_of_another_plan_is_not_removed(db):
    from fastapi import HTTPException

    from app.api.v1.floor_plans import delete_pin

    user, plan, pin, _ = await _seed(db)
    other = FloorPlan(project_id="p1", name="Этаж 2", image_key="plans/b.png")
    db.add(other)
    await db.commit()

    with pytest.raises(HTTPException) as error:
        await delete_pin("p1", other.id, pin.id, user=user, db=db)
    assert error.value.status_code == 404
    assert await db.get(FloorPlanPin, pin.id) is not None
