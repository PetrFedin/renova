"""Калькуляторы материалов комнаты Renova OS."""
from __future__ import annotations

from dataclasses import dataclass


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
    paint_layers: int = 2,
    paint_coverage_l_per_sqm: float = 0.15,
    wallpaper_roll_sq_m: float = 5.0,
) -> list[dict]:
    """Расчёт потребности в материалах по площадям комнаты."""
    tile_factor = {"straight": 1.10, "diagonal": 1.15, "complex": 1.20}.get(tile_layout, 1.10)
    laminate_factor = 1.07 if tile_layout != "diagonal" else 1.12
    clean_walls = max(0.0, wall_sq_m)
    plinth_m = max(0.0, perimeter_m - 0.9)

    items = [
        {"name": "Плитка", "unit": "м²", "qty": round(floor_sq_m * tile_factor, 2), "category": "tile", "note": f"запас {int((tile_factor-1)*100)}%"},
        {"name": "Ламинат", "unit": "м²", "qty": round(floor_sq_m * laminate_factor, 2), "category": "flooring", "note": "запас 7%"},
        {"name": "Краска интерьерная", "unit": "л", "qty": round(clean_walls * paint_layers * paint_coverage_l_per_sqm, 2), "category": "paint", "note": f"{paint_layers} слоя"},
        {"name": "Обои", "unit": "рул.", "qty": max(1, round(clean_walls / wallpaper_roll_sq_m * 1.1)), "category": "wallpaper", "note": "запас 10%"},
        {"name": "Плинтус", "unit": "м", "qty": round(plinth_m * 1.05, 2), "category": "flooring", "note": "минус дверь + запас"},
        {"name": "Клей для плитки", "unit": "кг", "qty": round(floor_sq_m * 4, 1), "category": "tile", "note": "4 кг/м²"},
        {"name": "Затирка", "unit": "кг", "qty": round(floor_sq_m * 0.5, 2), "category": "tile", "note": "0.5 кг/м²"},
    ]
    return items
