"""Дочерние ресурсы обязаны принадлежать объекту из адреса.

Найдено живой проверкой на стенде: проверка доступа выполнялась по
`project_id` из URL, а сама выборка — по идентификатору дочернего ресурса
без привязки к объекту. У кого есть хоть один свой объект, тот подставлял
свой `project_id` и чужой `room_id`/`line_id`/`tpl_id` — и читал или менял
чужое.

Три места, три последствия:
- `budget-room-lines` — чужие наименования работ и суммы плана и факта;
- `checklist-templates/{id}/versions` и `/diff` — содержимое чужих чек-листов,
  куда кладут коды домофонов и заметки об объекте;
- `PATCH estimate/lines/{id}` — запись: цена в чужой смете меняется, и
  `recalc_budget` добросовестно пересчитывает бюджет жертвы.
"""

import json

import pytest

from app.api.v1.analytics import budget_room_lines
from app.api.v1.estimate import LinePatch, patch_line
from app.api.v1.project_checklists import tpl_diff, tpl_versions
from app.models.entities import (
    ChecklistTemplateVersion,
    EstimateLine,
    LineType,
    Project,
    ProjectChecklistTemplate,
    Room,
    User,
    UserRole,
)
from fastapi import HTTPException

pytestmark = pytest.mark.asyncio


async def _tenant(db, suffix: str, *, role: UserRole = UserRole.customer) -> tuple[User, Project]:
    user = User(phone=f"+7999111{suffix}", role=role, full_name=f"Хозяин {suffix}")
    db.add(user)
    await db.flush()
    project = Project(
        name=f"Объект {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=user.id if role == UserRole.customer else None,
        contractor_id=user.id if role == UserRole.contractor else None,
        budget_planned=100_000,
    )
    if role == UserRole.contractor:
        owner = User(phone=f"+7999222{suffix}", role=UserRole.customer, full_name=f"Заказчик {suffix}")
        db.add(owner)
        await db.flush()
        project.customer_id = owner.id
    db.add(project)
    await db.flush()
    return user, project


async def test_room_lines_of_another_project_are_not_readable(db):
    intruder, own = await _tenant(db, "01")
    _, victim = await _tenant(db, "02")

    room = Room(project_id=victim.id, name="Санузел", length_m=2.0, width_m=1.8)
    db.add(room)
    await db.flush()
    db.add(
        EstimateLine(
            project_id=victim.id,
            room_id=room.id,
            line_type=LineType.work,
            name="СЕКРЕТНАЯ ГИДРОИЗОЛЯЦИЯ",
            unit="м2",
            quantity_planned=10,
            quantity_actual=30,
            unit_price=1_739,
        )
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await budget_room_lines(own.id, room.id, user=intruder, db=db)
    assert exc.value.status_code == 404


async def test_own_room_lines_are_still_readable(db):
    owner, project = await _tenant(db, "03")
    room = Room(project_id=project.id, name="Кухня", length_m=4.0, width_m=3.0)
    db.add(room)
    await db.flush()
    db.add(
        EstimateLine(
            project_id=project.id,
            room_id=room.id,
            line_type=LineType.work,
            name="Стяжка",
            unit="м2",
            quantity_planned=10,
            quantity_actual=30,
            unit_price=1_000,
        )
    )
    await db.commit()

    out = await budget_room_lines(project.id, room.id, user=owner, db=db)
    assert [x["name"] for x in out] == ["Стяжка"]
    assert out[0]["plan"] == 10_000
    assert out[0]["fact"] == 30_000


async def test_checklist_versions_of_another_project_are_not_readable(db):
    intruder, own = await _tenant(db, "04")
    _, victim = await _tenant(db, "05")

    tpl = ProjectChecklistTemplate(
        project_id=victim.id,
        name="ЧЕК-ЛИСТ СОСЕДА",
        items_json=json.dumps(["Код от двери 4417"], ensure_ascii=False),
    )
    db.add(tpl)
    await db.flush()
    db.add(
        ChecklistTemplateVersion(
            template_id=tpl.id,
            scope="project",
            name=tpl.name,
            items_json=tpl.items_json,
            version=1,
        )
    )
    await db.commit()

    for call in (tpl_versions, tpl_diff):
        with pytest.raises(HTTPException) as exc:
            await call(own.id, tpl.id, user=intruder, db=db, _=None)
        assert exc.value.status_code == 404, call.__name__


async def test_own_checklist_versions_are_still_readable(db):
    owner, project = await _tenant(db, "06")
    tpl = ProjectChecklistTemplate(
        project_id=project.id,
        name="Мой чек-лист",
        items_json=json.dumps(["Защита зон"], ensure_ascii=False),
    )
    db.add(tpl)
    await db.flush()
    db.add(
        ChecklistTemplateVersion(
            template_id=tpl.id, scope="project", name=tpl.name, items_json=tpl.items_json, version=1
        )
    )
    await db.commit()

    out = await tpl_versions(project.id, tpl.id, user=owner, db=db, _=None)
    assert out[0]["name"] == "Мой чек-лист"
    assert out[0]["items"] == ["Защита зон"]


async def test_estimate_line_of_another_project_is_not_writable(db):
    intruder, own = await _tenant(db, "07", role=UserRole.contractor)
    _, victim = await _tenant(db, "08")

    line = EstimateLine(
        project_id=victim.id,
        line_type=LineType.material,
        name="Паркет дуб",
        unit="м2",
        quantity_planned=10,
        quantity_actual=0,
        unit_price=50_000,
    )
    db.add(line)
    await db.commit()
    before_price = line.unit_price
    before_budget = victim.budget_planned

    with pytest.raises(HTTPException) as exc:
        await patch_line(
            own.id,
            line.id,
            LinePatch(unit_price=1),
            user=intruder,
            db=db,
        )
    assert exc.value.status_code == 404

    await db.refresh(line)
    await db.refresh(victim)
    assert line.unit_price == before_price, "цена в чужой смете изменилась"
    assert victim.budget_planned == before_budget, "бюджет чужого объекта пересчитан"
