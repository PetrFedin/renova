"""Ввоз собственного .ics стирал сроки всех этапов.

Разбор закрывал событие на строке `DTSTART`, а `DTEND` не читал вовсе:
каждому найденному этапу ставилось `update_stage_dates(stage.id, d, d)`.
То есть выгрузить календарь объекта и тут же ввезти его обратно означало
схлопнуть все этапы в однодневные. Проверено на живом стенде: восемь
этапов подряд потеряли даты окончания.

Здесь проверяется главное свойство — выгрузка и ввоз того же файла не
меняют ни одной даты.
"""

import pytest
from fastapi.responses import Response

from app.api.v1.calendar import IcalImportIn, export_ical, import_ical
from app.models.entities import Project, Room, Stage, StageStatus, User, UserRole

pytestmark = pytest.mark.asyncio


async def _project_with_stages(db, suffix: str) -> tuple[Project, User]:
    user = User(phone=f"+7999555{suffix}", role=UserRole.customer, full_name="Календарь")
    db.add(user)
    await db.flush()
    project = Project(
        name=f"Календарь {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=user.id,
    )
    db.add(project)
    await db.flush()
    db.add(Room(project_id=project.id, name="Кухня", length_m=4.0, width_m=3.0))
    spans = [
        ("Подготовка", "2026-10-01", "2026-10-04"),
        ("Демонтаж", "2026-10-05", "2026-10-09"),
        ("Черновые работы", "2026-10-10", "2026-10-18"),
    ]
    from datetime import date

    for i, (name, start, end) in enumerate(spans):
        db.add(
            Stage(
                project_id=project.id,
                name=name,
                sort_order=i,
                status=StageStatus.planned,
                planned_start=date.fromisoformat(start),
                planned_end=date.fromisoformat(end),
            )
        )
    await db.commit()
    await db.refresh(project, ["stages", "rooms"])
    return project, user


def _spans(project: Project) -> dict[str, tuple[str, str]]:
    return {
        s.name: (s.planned_start.isoformat(), s.planned_end.isoformat())
        for s in sorted(project.stages, key=lambda x: x.sort_order)
    }


async def test_export_then_import_keeps_every_date(db):
    project, user = await _project_with_stages(db, "01")
    before = _spans(project)

    exported: Response = await export_ical(project.id, user=user, db=db, _=None)
    content = exported.body.decode("utf-8")
    assert "DTEND;VALUE=DATE:" in content, "выгрузка перестала писать DTEND — проверку нужно пересмотреть"

    result = await import_ical(project.id, IcalImportIn(content=content), user=user, db=db)
    assert result["parsed"] == len(before)

    await db.refresh(project, ["stages"])
    after = _spans(project)
    assert after == before, f"ввоз собственного файла изменил сроки: {before} -> {after}"


async def test_import_without_dtend_keeps_a_single_day(db):
    """Событие без DTEND — по-прежнему один день. Прежнее поведение сохранено."""
    project, user = await _project_with_stages(db, "02")

    content = "\r\n".join([
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:renova-x@app",
        "SUMMARY:Подготовка",
        "DTSTART;VALUE=DATE:20261101",
        "END:VEVENT",
        "END:VCALENDAR",
    ])
    await import_ical(project.id, IcalImportIn(content=content), user=user, db=db)

    await db.refresh(project, ["stages"])
    assert _spans(project)["Подготовка"] == ("2026-11-01", "2026-11-01")


async def test_import_ignores_end_before_start(db):
    """Конец раньше начала не должен молча укорачивать этап."""
    project, user = await _project_with_stages(db, "03")

    content = "\r\n".join([
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:renova-y@app",
        "SUMMARY:Демонтаж",
        "DTSTART;VALUE=DATE:20261110",
        "DTEND;VALUE=DATE:20261101",
        "END:VEVENT",
        "END:VCALENDAR",
    ])
    await import_ical(project.id, IcalImportIn(content=content), user=user, db=db)

    await db.refresh(project, ["stages"])
    assert _spans(project)["Демонтаж"] == ("2026-11-10", "2026-11-10")
