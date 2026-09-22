"""Каталог работ: полнота ставок и целостность кодов."""
from app.data.work_market_rates import WORK_MARKET
from app.data.work_types import WORK_TYPES
from app.services.budget_planner_service import estimate_market

ALLOWED_CATEGORIES = {"prep", "engineering", "finish", "furnish", "logistics", "other"}
QTY_KEYS = {"points", "trips", "pcs", "wall_sq_m", "floor_sq_m", "perimeter_m"}


def test_every_work_type_has_market_rate():
    """Без ставки работа молча считалась бы по тарифу «custom» и врала в смете."""
    missing = [work["code"] for work in WORK_TYPES if work["code"] not in WORK_MARKET]
    assert missing == []


def test_work_type_codes_are_unique():
    codes = [work["code"] for work in WORK_TYPES]
    assert len(codes) == len(set(codes))


def test_work_type_names_are_unique():
    """Два одинаковых названия в списке выбора неразличимы для человека."""
    names = [work["name"] for work in WORK_TYPES]
    assert len(names) == len(set(names))


def test_work_type_categories_are_known():
    unknown = sorted({work["category"] for work in WORK_TYPES} - ALLOWED_CATEGORIES)
    assert unknown == []


def test_market_rate_qty_keys_are_supported():
    """Неизвестный ключ количества тихо превратился бы в площадь пола."""
    unknown = sorted({rate["default_qty_key"] for rate in WORK_MARKET.values()} - QTY_KEYS)
    assert unknown == []


def test_catalog_covers_main_renovation_categories():
    """Каталог должен покрывать весь цикл, иначе подбор работ бесполезен."""
    by_category: dict[str, int] = {}
    for work in WORK_TYPES:
        by_category[work["category"]] = by_category.get(work["category"], 0) + 1
    for category in ("prep", "engineering", "finish", "furnish", "logistics"):
        assert by_category.get(category, 0) >= 5, (category, by_category)
    assert len(WORK_TYPES) >= 60


def test_every_work_type_is_priceable():
    """Каждая работа из каталога должна давать ненулевую смету, а не ноль."""
    metrics = {
        "floor_sq_m": 20,
        "wall_sq_m": 45,
        "perimeter_m": 18,
        "points": 6,
        "pcs": 2,
        "trips": 1,
    }
    for work in WORK_TYPES:
        result = estimate_market(work_types=[work["code"]], metrics=metrics)
        assert result["grand_total"] > 0, work["code"]
