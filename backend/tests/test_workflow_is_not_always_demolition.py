"""Этап в ответе `/workflow` должен называть себя, а не «Демонтаж».

Найдено обходом живого приложения: `GET /projects/{id}/stages/{sid}/workflow`
возвращал `work_type: demolition` и название «Демонтаж» для семи этапов из
восьми — и тут же отдавал правильный чек-лист этого самого этапа. Один ответ
противоречил сам себе.

Причина: стандартные этапы Renova названы по-русски («Подготовка»,
«Инженерные системы», «Стены», «Потолок», «Чистовая отделка»), под `NAME_HINTS`
не подходят, а `resolve_work_type` заканчивается на `return code or
"demolition"`. Соответствие «имя этапа → тип работ» в коде было — в
`PHASE_TEMPLATES`, — но `get_template` в него не заглядывал.
"""
import pytest

from app.data.workflow_templates import (
    GENERIC_CHECKLIST,
    GENERIC_STEPS,
    PHASE_TEMPLATES,
    WORKFLOW_TEMPLATES,
    get_template,
)

STANDARD_PHASES = [
    "Подготовка",
    "Демонтаж",
    "Черновые работы",
    "Инженерные системы",
    "Стены",
    "Пол",
    "Потолок",
    "Чистовая отделка",
]


@pytest.mark.parametrize("stage_name", STANDARD_PHASES)
def test_stage_calls_itself_by_its_own_name(stage_name: str):
    template = get_template(None, stage_name)
    assert template["name"] == stage_name


def test_only_demolition_is_demolition():
    resolved = {name: get_template(None, name)["work_type"] for name in STANDARD_PHASES}
    demolition = [name for name, work_type in resolved.items() if work_type == "demolition"]
    assert demolition == ["Демонтаж"], (
        f"«Демонтаж» присвоен посторонним этапам: {resolved}"
    )


@pytest.mark.parametrize("stage_name", STANDARD_PHASES)
def test_checklist_belongs_to_the_same_stage(stage_name: str):
    # Ровно то противоречие, из-за которого дефект и был замечен: название и
    # шаги от одного этапа, чек-лист — от другого.
    template = get_template(None, stage_name)
    assert template["checklist"] == PHASE_TEMPLATES[stage_name]["checklist"]


def test_steps_come_from_the_trade_behind_the_phase():
    # «Стены» — это штукатурные работы: шаги обязаны быть их, а не общими.
    walls = get_template(None, "Стены")
    assert walls["steps"] == WORKFLOW_TEMPLATES["plaster"]["steps"]


def test_phase_without_a_trade_gets_neutral_steps():
    # «Подготовка» отображается в `preparation`, а такого шаблона работ нет —
    # общие шаги честнее, чем чужие.
    preparation = get_template(None, "Подготовка")
    assert preparation["work_type"] == "preparation"
    assert preparation["steps"] == GENERIC_STEPS


def test_unknown_stage_keeps_its_own_name():
    template = get_template(None, "Монтаж камина")
    assert template["name"] == "Монтаж камина"
    assert template["checklist"] == GENERIC_CHECKLIST


def test_explicit_work_type_still_wins():
    # Ручка `/workflow-templates/{work_type}` зовёт `get_template` без имени
    # этапа — прежнее поведение обязано сохраниться.
    assert get_template("electrical")["name"] == WORKFLOW_TEMPLATES["electrical"]["name"]
    assert get_template("electrical", "Стены")["work_type"] == "electrical"


def test_unrecognised_stage_is_not_filed_under_demolition():
    """Запасной вариант не должен выдавать чужой тип работ.

    `resolve_work_type` участвует и в построении зависимостей между этапами:
    все неопознанные этапы попадали в одну корзину с настоящим демонтажом, и
    работы, которым положено идти после демонтажа, привязывались к
    постороннему этапу с меньшим порядковым номером.
    """
    from app.data.workflow_templates import GENERIC_WORK_TYPE, resolve_work_type

    assert resolve_work_type(None, "Монтаж камина") == GENERIC_WORK_TYPE
    assert GENERIC_WORK_TYPE not in WORKFLOW_TEMPLATES, (
        "нейтральный тип попал в шаблоны работ — у него появятся чужие шаги "
        "и чужие зависимости"
    )
    # Настоящий демонтаж по-прежнему опознаётся.
    assert resolve_work_type(None, "Демонтаж перегородок") == "demolition"
    assert resolve_work_type("electrical", "что угодно") == "electrical"
