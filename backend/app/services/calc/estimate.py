"""Расчёт сметы — зеркало packages/calc-engine (единая логика формул)."""
from dataclasses import dataclass
from typing import Literal

RenovationType = Literal["cosmetic", "capital", "bathroom", "kitchen"]


@dataclass
class RoomMetrics:
    floor_sq_m: float
    wall_sq_m: float
    perimeter_m: float
    volume_cu_m: float


@dataclass
class CalcLine:
    line_type: str
    name: str
    unit: str
    quantity: float
    unit_price: float
    room_id: str
    room_name: str


def _r2(n: float) -> float:
    return round(n, 2)


def calc_room_metrics(length_m: float, width_m: float, height_m: float, openings_sq_m: float = 2) -> RoomMetrics:
    floor_sq_m = _r2(length_m * width_m)
    perimeter_m = _r2(2 * (length_m + width_m))
    wall_sq_m = _r2(max(0, perimeter_m * height_m - openings_sq_m))
    return RoomMetrics(floor_sq_m, wall_sq_m, perimeter_m, _r2(floor_sq_m * height_m))


def _waste(base: float, kind: str) -> float:
    factors = {"tile": 1.1, "wallpaper": 1.15, "paint": 1.05, "default": 1.08}
    return _r2(base * factors.get(kind, 1.08))



ROOM_TYPE_RENO: dict[str, str] = {
    "bathroom": "bathroom",
    "toilet": "bathroom",
    "kitchen": "kitchen",
}


def effective_renovation_type(project_type: str, room_type: str | None) -> str:
    if room_type and room_type in ROOM_TYPE_RENO:
        return ROOM_TYPE_RENO[room_type]
    return project_type


def generate_lines(reno_type: str, room_id: str, room_name: str, m: RoomMetrics) -> list[CalcLine]:
    if reno_type == "kitchen":
        tile_q = _waste(m.wall_sq_m * 0.4 + m.floor_sq_m, "tile")
        return [
            CalcLine("work", "Фартук плитка", "m2", _r2(m.wall_sq_m * 0.4), 1200, room_id, room_name),
            CalcLine("work", "Напольное покрытие", "m2", m.floor_sq_m, 450, room_id, room_name),
            CalcLine("work", "Электромонтаж кухни", "точка", 8, 850, room_id, room_name),
            CalcLine("material", "Плитка фартук", "m2", tile_q, 950, room_id, room_name),
            CalcLine("material", "Ламинат/кварц-винил", "m2", _waste(m.floor_sq_m, "default"), 1400, room_id, room_name),
        ]
    if reno_type == "capital":
        lines = generate_lines("cosmetic", room_id, room_name, m)
        lines.insert(0, CalcLine("work", "Демонтаж покрытий", "m2", _r2(m.wall_sq_m + m.floor_sq_m), 120, room_id, room_name))
        lines.append(CalcLine("work", "Штукатурка стен", "m2", m.wall_sq_m, 420, room_id, room_name))
        lines.append(CalcLine("material", "Штукатурная смесь", "kg", _r2(m.wall_sq_m * 8), 18, room_id, room_name))
        return lines
    if reno_type == "bathroom":
        tile_q = _waste(m.wall_sq_m + m.floor_sq_m, "tile")
        return [
            CalcLine("work", "Гидроизоляция", "m2", _r2(m.floor_sq_m + m.wall_sq_m), 650, room_id, room_name),
            CalcLine("work", "Укладка плитки", "m2", _r2(m.wall_sq_m + m.floor_sq_m), 1200, room_id, room_name),
            CalcLine("material", "Керамогранит", "m2", tile_q, 890, room_id, room_name),
            CalcLine("material", "Гидроизоляция Ceresit", "kg", _r2(m.floor_sq_m * 2), 420, room_id, room_name),
        ]
    paint_q = _waste(m.wall_sq_m, "paint")
    return [
        CalcLine("work", "Подготовка стен", "m2", m.wall_sq_m, 180, room_id, room_name),
        CalcLine("work", "Покраска стен 2 слоя", "m2", m.wall_sq_m, 320, room_id, room_name),
        CalcLine("work", "Укладка ламината", "m2", m.floor_sq_m, 450, room_id, room_name),
        CalcLine("material", "Краска интерьерная", "l", _r2(paint_q / 8), 890, room_id, room_name),
        CalcLine("material", "Ламинат", "m2", _waste(m.floor_sq_m, "default"), 1200, room_id, room_name),
    ]


def summary_total(lines: list[CalcLine], reserve_percent: float = 5) -> float:
    subtotal = sum(l.quantity * l.unit_price for l in lines)
    return _r2(subtotal * (1 + reserve_percent / 100))



# §4.3 Стандартный шаблон Renova — 14 этапов (Work Engine TOM 2)
STANDARD_RENOVA_STAGES: list[tuple[str, float]] = [
    ("Подготовка", 0.03),
    ("Демонтаж", 0.05),
    ("Черновые работы", 0.12),
    ("Инженерные системы", 0.15),
    ("Стены", 0.10),
    ("Пол", 0.10),
    ("Потолок", 0.08),
    ("Чистовая отделка", 0.12),
    ("Освещение", 0.05),
    ("Сантехника", 0.10),
    ("Мебель", 0.05),
    ("Уборка", 0.03),
    ("Приёмка", 0.05),
    ("Завершение проекта", 0.02),
]

DEFAULT_STAGES = STANDARD_RENOVA_STAGES

# Профили: подмножество стандартных этапов (пользователь может отключать позже)
STAGE_PLANS: dict[str, list[tuple[str, float]]] = {
    "cosmetic": [
        ("Подготовка", 0.05),
        ("Демонтаж", 0.08),
        ("Черновые работы", 0.15),
        ("Стены", 0.20),
        ("Пол", 0.15),
        ("Чистовая отделка", 0.25),
        ("Приёмка", 0.07),
        ("Завершение проекта", 0.05),
    ],
    "capital": STANDARD_RENOVA_STAGES,
    "bathroom": [
        ("Подготовка", 0.04),
        ("Демонтаж", 0.08),
        ("Черновые работы", 0.12),
        ("Инженерные системы", 0.18),
        ("Стены", 0.08),
        ("Пол", 0.10),
        ("Чистовая отделка", 0.15),
        ("Сантехника", 0.12),
        ("Приёмка", 0.08),
        ("Завершение проекта", 0.05),
    ],
    "kitchen": [
        ("Подготовка", 0.04),
        ("Демонтаж", 0.07),
        ("Черновые работы", 0.12),
        ("Инженерные системы", 0.20),
        ("Стены", 0.10),
        ("Пол", 0.12),
        ("Чистовая отделка", 0.22),
        ("Мебель", 0.08),
        ("Приёмка", 0.05),
    ],
}


def stages_for_renovation(renovation_type: str) -> list[tuple[str, float]]:
    return STAGE_PLANS.get(renovation_type, DEFAULT_STAGES)

