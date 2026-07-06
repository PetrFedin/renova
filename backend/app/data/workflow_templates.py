"""Шаблоны процессов Renova OS по типам работ."""
from __future__ import annotations

WORKFLOW_TEMPLATES: dict[str, dict] = {
    "electrical": {
        "name": "Электрика",
        "steps": [
            "Разметка точек", "Штробление", "Прокладка кабеля",
            "Установка подрозетников", "Фото скрытых работ", "Проверка", "Приёмка", "Закрытие этапа",
        ],
        "checklist": [
            "Есть фото скрытых работ", "Все розетки по плану", "Автоматы подписаны",
            "Кабель соответствует нагрузке", "Нет открытых соединений", "Работает освещение", "Работают выключатели",
        ],
        "depends_on": ["demolition", "plaster"],
    },
    "plumbing": {
        "name": "Сантехника",
        "steps": ["Разметка", "Демонтаж старых труб", "Прокладка труб", "Проверка давления", "Фото скрытых работ", "Приёмка", "Закрытие"],
        "checklist": ["Герметичность соединений", "Уклоны соблюдены", "Доступ к ревизиям", "Фото скрытых работ", "Нет протечек под давлением"],
        "depends_on": ["demolition"],
    },
    "tiling": {
        "name": "Плитка",
        "steps": ["Проверка основания", "Гидроизоляция", "Разметка", "Укладка", "Затирка", "Проверка швов", "Фото", "Приёмка"],
        "checklist": ["Ровные швы", "Нет пустот", "Нет сколов", "Совпадает раскладка", "Правильная затирка", "Нет перепадов", "Углы аккуратные"],
        "depends_on": ["plumbing", "plaster"],
    },
    "painting": {
        "name": "Покраска",
        "steps": ["Подготовка основания", "Шпаклёвка", "Шлифовка", "Грунтовка", "Первый слой", "Второй слой", "Проверка качества", "Приёмка"],
        "checklist": ["Нет пятен", "Нет подтёков", "Равномерный цвет", "Нет трещин", "Ровные примыкания", "Нет следов валика"],
        "depends_on": ["plaster"],
    },
    "plaster": {
        "name": "Штукатурка",
        "steps": ["Подготовка", "Маяки", "Нанесение", "Шлифовка", "Приёмка"],
        "checklist": ["Ровность по уровню", "Нет трещин", "Углы прямые"],
        "depends_on": ["demolition"],
    },
    "flooring": {
        "name": "Полы",
        "steps": ["Подготовка основания", "Подложка", "Укладка", "Плинтус", "Приёмка"],
        "checklist": ["Нет скрипов", "Зазоры соблюдены", "Плинтус установлен"],
        "depends_on": ["plaster"],
    },
    "demolition": {
        "name": "Демонтаж",
        "steps": ["Защита зон", "Демонтаж", "Вывоз мусора", "Приёмка"],
        "checklist": ["Мусор вывезен", "Коммуникации заглушены", "Соседние зоны защищены"],
        "depends_on": [],
    },
}

NAME_HINTS: list[tuple[str, str]] = [
    ("электр", "electrical"), ("сантех", "plumbing"), ("плитк", "tiling"),
    ("покрас", "painting"), ("штукатур", "plaster"), ("ламинат", "flooring"),
    ("пол", "flooring"), ("демонтаж", "demolition"),
]


def resolve_work_type(code: str | None = None, stage_name: str | None = None) -> str:
    if code and code in WORKFLOW_TEMPLATES:
        return code
    n = (stage_name or "").lower()
    for hint, wt in NAME_HINTS:
        if hint in n:
            return wt
    return code or "demolition"


def get_template(work_type: str | None = None, stage_name: str | None = None) -> dict:
    wt = resolve_work_type(work_type, stage_name)
    tpl = WORKFLOW_TEMPLATES.get(wt)
    if tpl:
        return {"work_type": wt, **tpl}
    return {
        "work_type": wt,
        "name": stage_name or "Работа",
        "steps": ["Выполнение", "Проверка", "Приёмка"],
        "checklist": ["Качество соответствует договорённости", "Убран мусор", "Материалы согласованы", "Фото зафиксированы"],
        "depends_on": [],
    }

# §4.6 Работы внутри стандартных этапов Renova (Work Engine TOM 2)
PHASE_TEMPLATES: dict[str, dict] = {
    "Подготовка": {"work_type": "preparation", "checklist": ["Защита зон", "Согласование с соседями", "Доставка материалов", "План работ утверждён"]},
    "Демонтаж": {"work_type": "demolition", "checklist": ["Защита зон", "Демонтаж покрытий", "Демонтаж перегородок", "Вывоз мусора", "Приёмка демонтажа"]},
    "Черновые работы": {"work_type": "plaster", "checklist": ["Стяжка пола", "Штукатурка стен", "Выравнивание потолка", "Грунтовка", "Приёмка черновых"]},
    "Инженерные системы": {"work_type": "electrical", "checklist": ["Разводка электрики", "Слаботочные сети", "Интернет", "Сантехника", "Отопление", "Вентиляция", "Кондиционирование"]},
    "Стены": {"work_type": "plaster", "checklist": ["Шпаклёвка", "Шлифовка", "Грунтовка", "Подготовка под отделку"]},
    "Пол": {"work_type": "flooring", "checklist": ["Подготовка основания", "Подложка", "Укладка покрытия", "Плинтус"]},
    "Потолок": {"work_type": "painting", "checklist": ["Каркас/штукатурка", "Покраска/натяжной", "Примыкания", "Приёмка"]},
    "Чистовая отделка": {"work_type": "painting", "checklist": ["Покраска", "Обои", "Декор", "Финишные элементы"]},
    "Освещение": {"work_type": "electrical", "checklist": ["Светильники", "Выключатели", "Диммеры", "Проверка"]},
    "Сантехника": {"work_type": "plumbing", "checklist": ["Смесители", "Унитаз/раковина", "Душ/ванна", "Сифоны", "Проверка на протечки"]},
    "Мебель": {"work_type": "preparation", "checklist": ["Сборка", "Установка", "Регулировка", "Фиксация"]},
    "Уборка": {"work_type": "preparation", "checklist": ["Строительная уборка", "Влажная уборка", "Вывоз упаковки"]},
    "Приёмка": {"work_type": "preparation", "checklist": ["Обход объекта", "Фото итогов", "Акт приёмки", "Закрытие замечаний"]},
    "Завершение проекта": {"work_type": "preparation", "checklist": ["Архив документов", "Гарантии", "Передача ключей", "Финальный отчёт"]},
}


def checklist_for_phase(stage_name: str | None, work_type: str | None = None) -> list[dict]:
    if stage_name and stage_name in PHASE_TEMPLATES:
        tpl = PHASE_TEMPLATES[stage_name]
        return [{"id": f"c{i}", "text": t, "done": False} for i, t in enumerate(tpl.get("checklist", []))]
    tpl = get_template(work_type, stage_name)
    return [{"id": f"c{i}", "text": t, "done": False} for i, t in enumerate(tpl.get("checklist", []))]
