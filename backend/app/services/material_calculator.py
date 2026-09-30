"""Калькуляторы материалов комнаты Renova OS."""
from __future__ import annotations

from dataclasses import dataclass

from app.services.calc.estimate import (
    PAINT_COATS,
    WALLPAPER_ROLL_SQM,
    WASTE_FACTORS,
    paint_liters,
    wallpaper_rolls,
)


@dataclass
class RoomCalcInput:
    floor_sq_m: float
    wall_sq_m: float
    perimeter_m: float
    openings_sq_m: float = 0
    door_width_m: float = 0.9


def calc_room_materials(
    floor_sq_m: float,
    wall_sq_m: float,
    perimeter_m: float,
    *,
    tile_layout: str = "straight",
    paint_layers: int = PAINT_COATS,
    wallpaper_roll_sq_m: float = WALLPAPER_ROLL_SQM,
) -> list[dict]:
    """Расчёт потребности в материалах по площадям комнаты.

    Нормы и запасы — общие с calc/estimate.py (сохранение строк сметы) и mobile calc-engine;
    эталоны: packages/calc-engine/reference-cases.json. Отрицательные площади считаются нулём.

    Известные отличия от строк сметы (намеренные): плитка и ламинат выводятся оба
    (это варианты покрытия пола на выбор, а не две одновременные строки); «диагональная»
    раскладка даёт запас плитки 15% / ламината 12%, в смете раскладки нет.
    """
    tile_factor = {"straight": WASTE_FACTORS["tile"], "diagonal": 1.15, "complex": 1.20}.get(tile_layout, WASTE_FACTORS["tile"])
    laminate_factor = WASTE_FACTORS["default"] if tile_layout != "diagonal" else 1.12
    floor = max(0.0, floor_sq_m)
    clean_walls = max(0.0, wall_sq_m)
    plinth_m = max(0.0, perimeter_m - 0.9)

    items = [
        {"name": "Плитка", "unit": "м²", "qty": round(floor * tile_factor, 2), "category": "tile", "note": f"запас {round((tile_factor - 1) * 100)}%"},
        {"name": "Ламинат", "unit": "м²", "qty": round(floor * laminate_factor, 2), "category": "flooring", "note": f"запас {round((laminate_factor - 1) * 100)}%"},
        {"name": "Краска интерьерная", "unit": "л", "qty": paint_liters(clean_walls, paint_layers), "category": "paint", "note": f"{paint_layers} слоя, запас 5%"},
        {"name": "Обои", "unit": "рул.", "qty": wallpaper_rolls(clean_walls, wallpaper_roll_sq_m), "category": "wallpaper", "note": "запас 15% на подгонку рисунка, округление вверх"},
        {"name": "Плинтус", "unit": "м", "qty": round(plinth_m * 1.05, 2), "category": "flooring", "note": "минус дверь + запас"},
        {"name": "Клей для плитки", "unit": "кг", "qty": round(floor * 4, 1), "category": "tile", "note": "4 кг/м²"},
        {"name": "Затирка", "unit": "кг", "qty": round(floor * 0.5, 2), "category": "tile", "note": "0.5 кг/м²"},
    ]
    return items
