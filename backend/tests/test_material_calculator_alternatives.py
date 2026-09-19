"""Расчёт материалов — это выбор, а не список покупок.

Плитка и ламинат ложатся на один и тот же пол, краска и обои — на одни и те
же стены. Расчёт отдавал их подряд, без всякой пометки, и экран показывал

    Плитка: 13.2 м²
    Ламинат: 12.84 м²

— один пол, посчитанный дважды. Человек читал это как список покупок и
закладывал в смету оба покрытия.

Открытого машиночитаемого источника норм (ГЭСН/ФЕР) нет: ФГИС ЦС публикует
документы, а не данные. Поэтому коэффициенты запаса остаются экспертными — но
теперь они подписаны в `note`, чтобы их можно было оспорить, не читая код.
"""

from __future__ import annotations

import pytest

from app.services.material_calculator import SURFACE_LABEL, calc_room_materials

# Комната 4×3, высота 2.7, проёмы 2 м².
FLOOR = 12.0
WALLS = 24.0
PERIMETER = 14.0


def test_every_item_says_what_surface_it_covers():
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)

    assert items, "расчёт вернулся пустым"
    for item in items:
        assert item.get("surface"), f"позиция без поверхности: {item['name']}"
        assert item["surface"] in SURFACE_LABEL, f"неизвестная поверхность: {item['surface']}"


def test_floor_finishes_are_marked_as_alternatives():
    """Главное: пол не должен считаться дважды."""
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)
    floor_finishes = [
        item for item in items if item.get("alternative_group") == "floor_finish"
    ]

    names = {item["name"] for item in floor_finishes}
    assert names == {"Плитка", "Ламинат"}, f"варианты пола изменились: {names}"
    for item in floor_finishes:
        assert item["surface"] == "floor"


def test_wall_finishes_are_marked_as_alternatives():
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)
    wall_finishes = {
        item["name"] for item in items if item.get("alternative_group") == "wall_finish"
    }
    assert wall_finishes == {"Краска интерьерная", "Обои"}, wall_finishes


def test_adhesive_and_grout_belong_to_the_tile_option():
    """Под ламинат плиточный клей не нужен — иначе смета снова завышена."""
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)
    companions = {item["name"]: item.get("requires") for item in items if item.get("requires")}

    assert companions == {"Клей для плитки": "Плитка", "Затирка": "Плитка"}, companions


def test_what_is_needed_regardless_of_the_choice():
    """Страховка: не всё должно оказаться вариантом."""
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)
    always = [
        item
        for item in items
        if not item.get("alternative_group") and not item.get("requires")
    ]
    assert [item["name"] for item in always] == ["Плинтус"], always


def test_the_numbers_still_follow_the_room():
    """Страховка от «разметили и сломали счёт»."""
    small = calc_room_materials(6.0, 12.0, 10.0)
    big = calc_room_materials(24.0, 48.0, 20.0)

    def qty(items, name):
        return next(item["qty"] for item in items if item["name"] == name)

    assert qty(big, "Плитка") > qty(small, "Плитка")
    assert qty(big, "Краска интерьерная") > qty(small, "Краска интерьерная")
    # Плитка с запасом 10% на 12 м² — это 13.2, а не «примерно столько».
    assert qty(calc_room_materials(FLOOR, WALLS, PERIMETER), "Плитка") == pytest.approx(13.2)


def test_the_waste_factors_are_written_out():
    """Коэффициенты экспертные, поэтому обязаны быть видимыми."""
    items = calc_room_materials(FLOOR, WALLS, PERIMETER)
    notes = {item["name"]: item.get("note") or "" for item in items}

    assert "10%" in notes["Плитка"], notes["Плитка"]
    assert "7%" in notes["Ламинат"], notes["Ламинат"]
    assert "л/м²" in notes["Краска интерьерная"], notes["Краска интерьерная"]
    assert "дверь" in notes["Плинтус"], notes["Плинтус"]


def test_a_diagonal_layout_needs_more_tile():
    """Раскладка влияет на запас — иначе параметр бессмысленный."""
    straight = calc_room_materials(FLOOR, WALLS, PERIMETER, tile_layout="straight")
    diagonal = calc_room_materials(FLOOR, WALLS, PERIMETER, tile_layout="diagonal")

    def qty(items, name):
        return next(item["qty"] for item in items if item["name"] == name)

    assert qty(diagonal, "Плитка") > qty(straight, "Плитка")
    assert qty(diagonal, "Ламинат") > qty(straight, "Ламинат")
