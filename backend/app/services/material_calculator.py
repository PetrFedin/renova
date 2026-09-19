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
    door_width_m: float = 0.9,
) -> list[dict]:
    """Расчёт потребности в материалах по площадям комнаты.

    Каждая позиция говорит, какую поверхность она закрывает (`surface`) и с
    чем конкурирует (`alternative_group`). Это не украшение ответа: плитка и
    ламинат ложатся на один и тот же пол, краска и обои — на одни и те же
    стены. Раньше расчёт отдавал их подряд, и экран показывал «Плитка 13.2 м²,
    Ламинат 12.8 м²» — один пол, посчитанный дважды. Человек читал это как
    список покупок.

    Коэффициенты запаса — экспертные. Открытого машиночитаемого источника
    норм (ГЭСН/ФЕР) нет: ФГИС ЦС публикует документы, а не данные, поэтому
    значения заданы здесь явно и подписаны в `note`, чтобы их можно было
    оспорить, а не искать в коде.
    """
    tile_factor = {"straight": 1.10, "diagonal": 1.15, "complex": 1.20}.get(tile_layout, 1.10)
    laminate_factor = 1.07 if tile_layout != "diagonal" else 1.12
    clean_walls = max(0.0, wall_sq_m)
    plinth_m = max(0.0, perimeter_m - door_width_m)

    return [
        {
            "name": "Плитка",
            "unit": "м²",
            "qty": round(floor_sq_m * tile_factor, 2),
            "category": "tile",
            "surface": "floor",
            "alternative_group": "floor_finish",
            "note": f"запас {int(round((tile_factor - 1) * 100))}%",
        },
        {
            "name": "Ламинат",
            "unit": "м²",
            "qty": round(floor_sq_m * laminate_factor, 2),
            "category": "flooring",
            "surface": "floor",
            "alternative_group": "floor_finish",
            "note": f"запас {int(round((laminate_factor - 1) * 100))}%",
        },
        {
            "name": "Краска интерьерная",
            "unit": "л",
            "qty": round(clean_walls * paint_layers * paint_coverage_l_per_sqm, 2),
            "category": "paint",
            "surface": "walls",
            "alternative_group": "wall_finish",
            "note": f"{paint_layers} слоя · {paint_coverage_l_per_sqm} л/м²",
        },
        {
            "name": "Обои",
            "unit": "рул.",
            "qty": max(1, round(clean_walls / wallpaper_roll_sq_m * 1.1)),
            "category": "wallpaper",
            "surface": "walls",
            "alternative_group": "wall_finish",
            "note": f"рулон {wallpaper_roll_sq_m} м² · запас 10%",
        },
        # Ниже — то, что нужно независимо от выбора отделки.
        {
            "name": "Плинтус",
            "unit": "м",
            "qty": round(plinth_m * 1.05, 2),
            "category": "flooring",
            "surface": "trim",
            "alternative_group": None,
            "note": f"минус дверь {door_width_m} м · запас 5%",
        },
        {
            "name": "Клей для плитки",
            "unit": "кг",
            "qty": round(floor_sq_m * 4, 1),
            "category": "tile",
            "surface": "floor",
            # Клей нужен только под плитку — он идёт вместе с ней, а не вместо.
            "alternative_group": None,
            "requires": "Плитка",
            "note": "4 кг/м²",
        },
        {
            "name": "Затирка",
            "unit": "кг",
            "qty": round(floor_sq_m * 0.5, 2),
            "category": "tile",
            "surface": "floor",
            "alternative_group": None,
            "requires": "Плитка",
            "note": "0.5 кг/м²",
        },
    ]


#: Человеческие названия поверхностей — для экрана и отчётов.
SURFACE_LABEL = {
    "floor": "Пол",
    "walls": "Стены",
    "trim": "Отделка примыканий",
}
