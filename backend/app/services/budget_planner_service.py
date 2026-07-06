"""Планировщик бюджета: рынок, работа/материалы, сроки, Лемана ПРО."""
from __future__ import annotations

from datetime import date, timedelta

from app.data.market_regions import REGION_BY_CODE, REGIONS
from app.data.work_market_rates import WORK_MARKET, SEASONAL
from app.data.lemana_catalog import suggest_lemana_products
from app.services.material_calculator import calc_room_materials


def _qty(metrics: dict, wt: str) -> float:
    m = WORK_MARKET.get(wt, WORK_MARKET["custom"])
    key = m["default_qty_key"]
    if key == "points":
        return float(metrics.get("outlets_count", 0) + metrics.get("plumbing_points", 0) or metrics.get("points", 4))
    if key == "trips":
        return float(metrics.get("trips", 1))
    if key == "pcs":
        return float(metrics.get("pcs", 1))
    if key == "wall_sq_m":
        return float(metrics.get("wall_sq_m", metrics.get("floor_sq_m", 10)))
    return float(metrics.get("floor_sq_m", 10))


def estimate_market(
    *,
    region_code: str = "moscow",
    work_types: list[str],
    metrics: dict,
    complexity: float = 1.0,
    labor_share_override: float | None = None,
) -> dict:
    """Рыночная прикидка: работа / материалы / срок / детализация."""
    reg = REGION_BY_CODE.get(region_code, REGION_BY_CODE["other"])
    li, mi = reg["labor_index"], reg["material_index"]
    cx = max(0.7, min(1.5, complexity))

    lines = []
    labor_total = 0.0
    materials_total = 0.0
    days_total = 0.0

    for wt in work_types:
        m = WORK_MARKET.get(wt, WORK_MARKET["custom"])
        qty = _qty(metrics, wt) * cx
        labor = round(qty * m["labor_rate"] * li, 2)
        share = labor_share_override if labor_share_override is not None else m["material_share"]
        if labor_share_override is not None:
            materials = round(labor * (1 - labor_share_override) / max(labor_share_override, 0.01), 2) if labor_share_override < 1 else 0
        else:
            materials = round(labor * share / max(1 - share, 0.01), 2) if share < 1 else 0
        materials = round(materials * mi, 2)
        days = round(qty / max(m["productivity"], 0.5), 1)
        labor_total += labor
        materials_total += materials
        days_total += days
        lines.append({
            "work_type": wt,
            "qty": round(qty, 2),
            "unit": m["unit"],
            "labor": labor,
            "materials": materials,
            "days": days,
        })

    # Несколько работ — перекрытие бригады
    if len(work_types) > 1:
        days_total = round(days_total * 0.85, 1)
        labor_total = round(labor_total * 0.95, 2)

    subtotal = round(labor_total + materials_total, 2)
    reserve = round(subtotal * 0.05, 2)
    grand = round(subtotal + reserve, 2)

    # Расходники из калькулятора комнаты
    consumables = calc_room_materials(
        float(metrics.get("floor_sq_m", 10)),
        float(metrics.get("wall_sq_m", 20)),
        float(metrics.get("perimeter_m", 14)),
    )
    for c in consumables:
        c["estimated_price"] = _consumable_price(c, mi)
        c["total"] = round(c["qty"] * c["estimated_price"], 2)

    lemana = suggest_lemana_products(work_types)
    trend = price_trend_6m(region_code, work_types, grand)

    return {
        "region": reg,
        "complexity": cx,
        "labor_total": round(labor_total, 2),
        "materials_total": round(materials_total, 2),
        "labor_share": round(labor_total / subtotal, 3) if subtotal else 0.5,
        "materials_share": round(materials_total / subtotal, 3) if subtotal else 0.5,
        "days_estimated": days_total,
        "reserve": reserve,
        "grand_total": grand,
        "lines": lines,
        "consumables": consumables,
        "lemana_suggestions": lemana,
        "price_trend_6m": trend,
        "disclaimer": "Ориентир по рынку. Материалы и работы зависят от сезона и поставщика.",
    }


def _consumable_price(item: dict, material_index: float) -> float:
    base = {"tile": 890, "flooring": 1200, "paint": 890, "wallpaper": 650, "plaster": 18}.get(item.get("category", ""), 500)
    if item["unit"] == "л":
        base = 890
    if item["unit"] == "кг":
        base = 18
    if item["unit"] == "рул.":
        base = 650
    return round(base * material_index, 2)


def price_trend_6m(region_code: str, work_types: list[str], current_total: float) -> list[dict]:
    """Динамика ориентира за 6 месяцев (сезон + регион)."""
    reg = REGION_BY_CODE.get(region_code, REGION_BY_CODE["other"])
    today = date.today()
    out = []
    wt_factor = 1.0 + 0.02 * len(work_types)
    for i in range(5, -1, -1):
        d = today.replace(day=1) - timedelta(days=30 * i)
        month_idx = d.month - 1
        seasonal = SEASONAL[month_idx]
        regional = (reg["labor_index"] + reg["material_index"]) / 2
        # небольшой тренд роста YoY
        growth = 1.0 + (5 - i) * 0.008
        value = round(current_total * seasonal * regional * growth / max(regional, 0.01) * 0.98, 0)
        out.append({"month": d.strftime("%Y-%m"), "label": d.strftime("%b %Y"), "total": value, "index": round(seasonal * 100)})
    return out


def list_regions() -> list[dict]:
    return REGIONS
