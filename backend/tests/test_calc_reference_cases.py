"""Эталонные расчёты материалов (EST-030): общий JSON с mobile calc-engine.

Файл packages/calc-engine/reference-cases.json читают и этот тест, и
apps/mobile/lib/calc-engine/referenceCases.test.ts — нормы не могут разойтись молча.
"""
import json
import math
from pathlib import Path

import pytest

from app.services.calc.estimate import calc_room_metrics, generate_lines
from app.services.material_calculator import calc_room_materials

REFERENCE = json.loads(
    (Path(__file__).resolve().parents[2] / "packages" / "calc-engine" / "reference-cases.json").read_text(encoding="utf-8")
)
CASES = REFERENCE["cases"]


def _line(lines, name):
    return next(l for l in lines if l.name == name)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_saved_estimate_lines_match_reference(case):
    r, exp = case["room"], case["expected"]
    m = calc_room_metrics(r["length_m"], r["width_m"], r["height_m"], r["openings_sq_m"])
    assert (m.floor_sq_m, m.wall_sq_m, m.perimeter_m) == (exp["floor_sq_m"], exp["wall_sq_m"], exp["perimeter_m"])

    cosmetic = generate_lines("cosmetic", "r", "R", m)
    assert _line(cosmetic, "Краска интерьерная").quantity == pytest.approx(exp["paint_l"], abs=0.005)
    assert _line(cosmetic, "Ламинат").quantity == pytest.approx(exp["laminate_sq_m"], abs=0.005)
    capital = generate_lines("capital", "r", "R", m)
    assert _line(capital, "Штукатурная смесь").quantity == pytest.approx(exp["plaster_kg"], abs=0.005)
    bathroom = generate_lines("bathroom", "r", "R", m)
    assert _line(bathroom, "Керамогранит").quantity == pytest.approx(exp["bathroom_tile_sq_m"], abs=0.005)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_room_material_calculator_matches_reference(case):
    exp = case["expected"]
    items = {i["category"] + ":" + i["name"]: i for i in calc_room_materials(exp["floor_sq_m"], exp["wall_sq_m"], exp["perimeter_m"])}
    assert items["paint:Краска интерьерная"]["qty"] == pytest.approx(exp["paint_l"], abs=0.005)
    assert items["flooring:Ламинат"]["qty"] == pytest.approx(exp["laminate_sq_m"], abs=0.005)
    assert items["tile:Плитка"]["qty"] == pytest.approx(exp["floor_tile_sq_m"], abs=0.005)
    assert items["wallpaper:Обои"]["qty"] == exp["wallpaper_rolls"]


def test_wallpaper_rounds_up_and_covers_wall_area_with_pattern_reserve():
    # 47 м² стен: раньше round() → 10 рулонов = 50 м² < 47 × 1.15 = 54,05 м²
    qty = next(i for i in calc_room_materials(10, 47, 14) if i["category"] == "wallpaper")["qty"]
    assert qty == 11
    assert qty * 5.0 >= 47 * 1.15


def test_degenerate_inputs_do_not_produce_negative_or_phantom_quantities():
    items = calc_room_materials(-5, -10, 3)
    assert all(i["qty"] >= 0 for i in items)
    wallpaper = next(i for i in items if i["category"] == "wallpaper")
    assert wallpaper["qty"] == 0  # нет стен — нет обоев (раньше минимум 1 рулон)


def test_paint_norms_are_the_same_in_both_backend_calculators():
    m = calc_room_metrics(4.2, 3.1, 2.7, 2)
    saved = _line(generate_lines("cosmetic", "r", "R", m), "Краска интерьерная").quantity
    consumable = next(i for i in calc_room_materials(m.floor_sq_m, m.wall_sq_m, m.perimeter_m) if i["category"] == "paint")["qty"]
    assert saved == consumable == 9.82
    assert math.isclose(saved, 9.82)
