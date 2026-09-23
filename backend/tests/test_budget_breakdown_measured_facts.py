"""#318: факт по статьям сметы должен быть измеренной величиной, а не планом.

`budget-breakdown` отдавал план по работам, вывозу и резерву, а клиент
подставлял то же число в поле «факт». Отклонение по этим статьям выходило
нулевым при любых данных, и перерасход по работам не мог быть обнаружен.

Здесь проверяется и обратное: ноль записей — это «не зафиксировано», и клиент
должен получить возможность отличить его от «потрачено ноль». Поэтому рядом
с каждым фактом идёт число записей, на которых он держится.
"""

import pytest

from app.api.v1.analytics import budget_breakdown
from app.models.entities import (
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    User,
    UserRole,
    WasteOrder,
    WasteOrderStatus,
)

pytestmark = pytest.mark.asyncio


async def _project(db, suffix: str) -> tuple[Project, User]:
    user = User(phone=f"+79995550{suffix}", role=UserRole.customer, full_name="Breakdown")
    db.add(user)
    await db.flush()
    project = Project(
        name=f"Breakdown {suffix}",
        renovation_type="full",
        property_type="apartment",
        customer_id=user.id,
        budget_planned=900_000,
        budget_spent=410_000,
    )
    db.add(project)
    await db.flush()
    return project, user


async def test_works_fact_comes_from_actual_quantities_not_from_plan(db):
    project, user = await _project(db, "01")
    db.add_all(
        [
            # План 500 000, факт 620 000 — перерасход, который прежняя разбивка
            # не могла показать в принципе.
            EstimateLine(
                project_id=project.id,
                line_type=LineType.work,
                name="Стяжка",
                unit="м2",
                quantity_planned=100,
                quantity_actual=124,
                unit_price=5_000,
            ),
            EstimateLine(
                project_id=project.id,
                line_type=LineType.material,
                name="Плитка",
                unit="м2",
                quantity_planned=60,
                quantity_actual=0,
                unit_price=5_000,
            ),
        ]
    )
    await db.commit()

    out = await budget_breakdown(project.id, user=user, db=db)

    assert out["works"] == 500_000
    assert out["works_fact"] == 620_000
    assert out["works_fact"] != out["works"]
    assert out["works_fact_records"] == 1


async def test_waste_fact_counts_only_completed_orders(db):
    project, user = await _project(db, "02")
    db.add_all(
        [
            WasteOrder(project_id=project.id, volume_m3=5, price=2_000, status=WasteOrderStatus.done),
            WasteOrder(project_id=project.id, volume_m3=3, price=2_000, status=WasteOrderStatus.scheduled),
            WasteOrder(project_id=project.id, volume_m3=9, price=2_000, status=WasteOrderStatus.cancelled),
        ]
    )
    await db.commit()

    out = await budget_breakdown(project.id, user=user, db=db)

    # План — всё, кроме отменённого: 5 + 3 кубометра.
    assert out["waste"] == 16_000
    # Факт — только выполненный заказ.
    assert out["waste_fact"] == 10_000
    assert out["waste_fact_records"] == 1


async def test_absent_records_are_reported_as_zero_records_not_as_spending(db):
    project, user = await _project(db, "03")
    db.add(
        EstimateLine(
            project_id=project.id,
            line_type=LineType.work,
            name="Штукатурка",
            unit="м2",
            quantity_planned=80,
            quantity_actual=0,
            unit_price=4_000,
        )
    )
    await db.commit()

    out = await budget_breakdown(project.id, user=user, db=db)

    assert out["works"] == 320_000
    assert out["works_fact"] == 0
    # Ключевое: ноль рублей факта сопровождён нулём записей — клиент по этому
    # признаку показывает «факт не зафиксирован», а не «потрачено ноль».
    assert out["works_fact_records"] == 0
    assert out["waste_fact_records"] == 0
    assert out["materials_fact_records"] == 0


async def test_materials_fact_counts_approved_and_purchased_picks(db):
    project, user = await _project(db, "04")
    db.add_all(
        [
            MaterialPick(project_id=project.id, name="Ламинат", qty=10, price=1_500, status=MaterialPickStatus.purchased),
            MaterialPick(project_id=project.id, name="Клей", qty=4, price=500, status=MaterialPickStatus.approved),
            MaterialPick(project_id=project.id, name="Плинтус", qty=20, price=300, status=MaterialPickStatus.draft),
        ]
    )
    await db.commit()

    out = await budget_breakdown(project.id, user=user, db=db)

    assert out["materials_fact"] == 17_000
    assert out["materials_fact_records"] == 2


async def test_existing_fields_are_preserved(db):
    project, user = await _project(db, "05")
    await db.commit()

    out = await budget_breakdown(project.id, user=user, db=db)

    for key in ("works", "materials_plan", "materials_fact", "waste", "reserve", "total_planned", "budget_planned", "budget_spent"):
        assert key in out, key
    assert out["budget_planned"] == 900_000
    assert out["budget_spent"] == 410_000
