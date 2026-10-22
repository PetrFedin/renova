"""Карточка этапа не врёт про этап.

Три вещи, которые видел пользователь.

1. Из четырнадцати стандартных этапов **одиннадцать** показывались как
   «Демонтаж»: `resolve_work_type` возвращал `"demolition"` как фолбэк для
   любого нераспознанного названия. На этапе «Подготовка» стояли шаги
   демонтажа («Вывоз мусора») и чужой чек-лист («Коммуникации заглушены»).

2. Возврат этапа на доработку добавлял в чек-лист пункт с ключом `title`,
   тогда как все остальные пункты — и весь экран — используют `text`.
   Исполнитель видел, что пункт добавился, и не видел, что именно исправлять:
   строка рисовалась пустой.

3. Легаси-маршрут приёмки не объявлял `quality_score` в схеме, поэтому оценку,
   отправленную клиентом, валидатор молча отбрасывал: ответ 200, оценки нет,
   объяснения нет. (Канонический маршрут её сохранял — это проверено отдельно,
   чтобы не «чинить» работающее.)
"""

from __future__ import annotations

import json

from app.data.workflow_templates import (
    WORKFLOW_TEMPLATES,
    checklist_for_phase,
    get_template,
    resolve_work_type,
)
from app.services.calc.estimate import DEFAULT_STAGES


def _stage_names() -> list[str]:
    names = []
    for item in DEFAULT_STAGES:
        if isinstance(item, (tuple, list)):
            names.append(str(item[0]))
        elif isinstance(item, dict):
            names.append(str(item.get("name")))
        else:
            names.append(str(item))
    return names


# --- 1. вид работ ---------------------------------------------------------------


def test_an_unrecognised_stage_is_not_called_demolition():
    """Ошибиться видом работ хуже, чем честно не знать его."""
    assert resolve_work_type(None, "Подготовка") != "demolition"
    assert resolve_work_type(None, "Завершение проекта") != "demolition"
    assert resolve_work_type(None, "Совершенно новый этап") != "demolition"


def test_the_fallback_template_exists_and_is_neutral():
    assert "general" in WORKFLOW_TEMPLATES
    template = get_template("general")
    assert template["name"] == "Работы по этапу"
    assert template["steps"], "у общего шаблона нет шагов"
    assert template["checklist"], "у общего шаблона нет чек-листа"
    # Ничего демонтажного в нейтральном шаблоне быть не должно.
    text = json.dumps(template, ensure_ascii=False).lower()
    for foreign in ("демонтаж", "мусор", "заглушен"):
        assert foreign not in text, f"в общем шаблоне чужое слово «{foreign}»"


def test_demolition_is_still_recognised_when_it_really_is_demolition():
    """Страховка: фолбэк не должен съесть настоящий демонтаж."""
    assert resolve_work_type(None, "Демонтаж") == "demolition"
    assert resolve_work_type("demolition", None) == "demolition"


def test_the_names_that_map_correctly_still_map():
    """Страховка: остальные подсказки не сломаны."""
    assert resolve_work_type(None, "Сантехника") == "plumbing"
    assert resolve_work_type(None, "Пол") == "flooring"
    assert resolve_work_type(None, "Электрика") == "electrical"
    # Освещение — это электрика, а не «нераспознанное».
    assert resolve_work_type(None, "Освещение") == "electrical"


def test_most_standard_stages_no_longer_pretend_to_be_demolition():
    names = _stage_names()
    demolition = [n for n in names if resolve_work_type(None, n) == "demolition"]

    assert demolition == ["Демонтаж"], (
        f"как демонтаж показываются: {demolition} из {len(names)} этапов"
    )


# --- 2. пункт доработки ---------------------------------------------------------


def test_the_rework_item_uses_the_same_key_as_every_other_item():
    """Иначе пункт рисуется пустой строкой."""
    from app.services.stage_review_service import _append_rework_item

    class _Stage:
        checklist_json = json.dumps(checklist_for_phase("Подготовка"), ensure_ascii=False)
        percent_complete = 0.0
        name = "Подготовка"
        work_type = None

    stage = _Stage()
    _append_rework_item(stage, "Мусор не вывезен")
    items = json.loads(stage.checklist_json)

    rework = [item for item in items if str(item.get("id", "")).startswith("rework-")]
    assert rework, "пункт доработки не добавился"
    for item in rework:
        assert "text" in item, f"пункт доработки без ключа text: {item}"
        assert item["text"], "текст пункта доработки пуст"
        assert "Мусор не вывезен" in item["text"]

    # И все пункты списка должны быть одного вида — экран читает один ключ.
    keys = {tuple(sorted(item.keys())) for item in items}
    assert len(keys) == 1, f"пункты чек-листа разной формы: {keys}"


# --- 3. оценка качества ---------------------------------------------------------


def test_the_legacy_acceptance_route_accepts_a_score():
    """Поле должно существовать в схеме, иначе валидатор молча его отбросит."""
    from app.api.v1.os import AcceptIn

    parsed = AcceptIn.model_validate({"with_remarks": False, "quality_score": 5})
    assert parsed.quality_score == 5

    # Границы те же, что у канонического маршрута.
    import pytest

    with pytest.raises(Exception):
        AcceptIn.model_validate({"quality_score": 11})


def test_the_canonical_route_still_writes_the_score():
    """Страховка от ложной правки: канонический путь и так работал."""
    import inspect

    from app.services import accept_orchestrator

    source = inspect.getsource(accept_orchestrator)
    assert "row.quality_score = quality_score" in source, (
        "канонический путь перестал сохранять оценку заказчика"
    )
