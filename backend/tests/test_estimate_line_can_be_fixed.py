"""Ошибку в строке сметы можно исправить или убрать.

Найдено разбором полноты жизненного цикла сущностей.

1. `DELETE` для строк сметы не существовало вовсе: ошибочную позицию нельзя
   было убрать, оставалось «обнулить количество» — и она продолжала висеть
   в смете, которую заказчик читает перед фиксацией.
2. `LinePatch` знал только `quantity_planned`, `unit_price` и
   `quantity_actual`. Ошибку в наименовании или единице измерения исправить
   было невозможно.
3. `notes` форма шлёт, схема принимает, колонка пишется — а в `EstimateLineOut`
   поля не было. Комментарий к позиции исчезал после сохранения.
"""
import pathlib

import pytest

from app.models.entities import EstimateLine, LineType, Project

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTES = (ROOT / "app" / "api" / "v1" / "estimate.py").read_text()
SCHEMAS = (ROOT / "app" / "schemas" / "project.py").read_text()
PROJECTS = (ROOT / "app" / "api" / "v1" / "projects.py").read_text()


async def _seed(db, project_id: str = "p1") -> EstimateLine:
    db.add(Project(id=project_id, name="Объект", customer_id="u-cust", renovation_type="cosmetic"))
    line = EstimateLine(
        project_id=project_id,
        line_type=LineType.work,
        name="Штукатурка стен",
        unit="m2",
        quantity_planned=10.0,
        unit_price=500.0,
    )
    db.add(line)
    await db.flush()
    await db.commit()
    return line


@pytest.mark.asyncio
async def test_line_can_be_deleted(db):
    from app.services.estimate_service import delete_line

    line = await _seed(db)
    assert await delete_line(db, line.id, project_id="p1") is True
    assert await db.get(EstimateLine, line.id) is None


@pytest.mark.asyncio
async def test_line_of_another_project_is_not_deleted(db):
    # Без сверки с объектом из пути удаление можно было бы адресовать чужой
    # строке, зная её идентификатор.
    from app.services.estimate_service import delete_line

    line = await _seed(db)
    assert await delete_line(db, line.id, project_id="другой") is False
    assert await db.get(EstimateLine, line.id) is not None


@pytest.mark.asyncio
async def test_missing_line_is_not_a_crash(db):
    from app.services.estimate_service import delete_line

    assert await delete_line(db, "нет-такой", project_id="p1") is False


@pytest.mark.asyncio
async def test_name_and_unit_can_be_corrected(db):
    from app.services.estimate_service import update_line

    line = await _seed(db)
    updated = await update_line(
        db, line.id, project_id="p1", name="Штукатурка потолка", unit="м2"
    )
    assert updated is not None
    assert updated.name == "Штукатурка потолка"
    assert updated.unit == "м2"


@pytest.mark.asyncio
async def test_patch_of_another_project_is_refused(db):
    from app.services.estimate_service import update_line

    line = await _seed(db)
    assert await update_line(db, line.id, project_id="другой", name="чужое") is None
    assert (await db.get(EstimateLine, line.id)).name == "Штукатурка стен"


@pytest.mark.asyncio
async def test_quantity_and_price_still_work(db):
    # Проверка не должна проходить оттого, что сломалось прежнее.
    from app.services.estimate_service import update_line

    line = await _seed(db)
    updated = await update_line(db, line.id, project_id="p1", quantity_planned=3.0, unit_price=750.0)
    assert updated is not None
    assert updated.quantity_planned == 3.0
    assert updated.unit_price == 750.0


@pytest.mark.asyncio
async def test_note_survives_saving(db):
    from app.services.estimate_service import update_line

    line = await _seed(db)
    updated = await update_line(db, line.id, project_id="p1", notes="по согласованию с дизайнером")
    assert updated is not None
    assert updated.notes == "по согласованию с дизайнером"


def test_note_reaches_the_client():
    assert "notes: str | None = None" in SCHEMAS.split("class EstimateLineOut")[1].split("class StageOut")[0]
    assert "notes=l.notes," in PROJECTS, "заметка снова не доезжает до приложения"


def test_locked_estimate_refuses_delete():
    # После фиксации смета — цена договора; правки идут через изменение сметы.
    block = ROUTES.split('@router.delete("/lines/{line_id}")')[1].split("@router.")[0]
    assert "_require_estimate_editable" in block
    assert "Только исполнитель редактирует смету" in block


def test_delete_is_bound_to_the_path_project():
    block = ROUTES.split('@router.delete("/lines/{line_id}")')[1].split("@router.")[0]
    assert "project_id=project_id" in block


def test_patch_is_bound_to_the_path_project():
    block = ROUTES.split('@router.patch("/lines/{line_id}")')[1].split("@router.")[0]
    assert "project_id=project_id" in block
