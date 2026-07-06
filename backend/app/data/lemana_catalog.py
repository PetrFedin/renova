"""Подсказки материалов Лемана ПРО."""
from urllib.parse import quote_plus
LEMANA_BASE = "https://lemanapro.ru/search?query="
LEMANA_BY_CATEGORY = {
    "paint": [
        {"name": "Краска интерьерная 9 л", "unit": "шт", "avg_price": 2890, "sku_hint": "краска интерьерная 9л"},
        {"name": "Грунтовка 10 л", "unit": "шт", "avg_price": 1250, "sku_hint": "грунтовка 10л"},
    ],
    "tile": [
        {"name": "Керамогранит 60×60", "unit": "м²", "avg_price": 890, "sku_hint": "керамогранит 60x60"},
        {"name": "Клей для плитки 25 кг", "unit": "меш", "avg_price": 520, "sku_hint": "клей плитка 25кг"},
    ],
    "flooring": [
        {"name": "Ламинат 33 класс", "unit": "м²", "avg_price": 1200, "sku_hint": "ламинат 33 класс"},
        {"name": "Подложка 3 мм", "unit": "м²", "avg_price": 95, "sku_hint": "подложка ламинат"},
    ],
    "electrical": [
        {"name": "Розетка", "unit": "шт", "avg_price": 220, "sku_hint": "розетка"},
        {"name": "Кабель ВВГнг 3×2.5", "unit": "м", "avg_price": 85, "sku_hint": "кабель vvg 3x2.5"},
    ],
    "plumbing": [
        {"name": "Смеситель", "unit": "шт", "avg_price": 3200, "sku_hint": "смеситель"},
        {"name": "Труба PPR 20", "unit": "м", "avg_price": 65, "sku_hint": "труба ppr 20"},
    ],
    "plaster": [
        {"name": "Штукатурка 30 кг", "unit": "меш", "avg_price": 480, "sku_hint": "штукатурка 30кг"},
    ],
}
WORK_TYPE_TO_CATEGORIES = {
    "electrical": ["electrical"], "outlet_install": ["electrical"],
    "plumbing": ["plumbing"], "sewage": ["plumbing"],
    "painting": ["paint"], "paint_walls": ["paint"], "plaster": ["plaster"],
    "tiling": ["tile"], "flooring": ["flooring"], "floor_screed": ["plaster", "flooring"],
    "custom": ["paint"],
}

def lemana_search_url(q: str) -> str:
    return LEMANA_BASE + quote_plus(q)

def suggest_lemana_products(work_types: list[str]) -> list[dict]:
    seen, out = set(), []
    for wt in work_types:
        for cat in WORK_TYPE_TO_CATEGORIES.get(wt, []):
            for item in LEMANA_BY_CATEGORY.get(cat, []):
                if item["name"] in seen: continue
                seen.add(item["name"])
                out.append({**item, "shop_name": "Лемана ПРО", "shop_url": lemana_search_url(item["sku_hint"]), "source": "lemana_catalog"})
    return out
