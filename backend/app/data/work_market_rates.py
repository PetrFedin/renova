"""Базовые рыночные ставки работ (Москва)."""
WORK_MARKET = {
    "electrical": {"unit": "point", "labor_rate": 850, "productivity": 8, "material_share": 0.35, "default_qty_key": "points"},
    "outlet_install": {"unit": "point", "labor_rate": 850, "productivity": 10, "material_share": 0.40, "default_qty_key": "points"},
    "plumbing": {"unit": "point", "labor_rate": 3500, "productivity": 2, "material_share": 0.45, "default_qty_key": "points"},
    "sewage": {"unit": "point", "labor_rate": 4200, "productivity": 1.5, "material_share": 0.50, "default_qty_key": "points"},
    "painting": {"unit": "m2", "labor_rate": 320, "productivity": 25, "material_share": 0.30, "default_qty_key": "wall_sq_m"},
    "paint_walls": {"unit": "m2", "labor_rate": 320, "productivity": 25, "material_share": 0.30, "default_qty_key": "wall_sq_m"},
    "plaster": {"unit": "m2", "labor_rate": 420, "productivity": 12, "material_share": 0.40, "default_qty_key": "wall_sq_m"},
    "tiling": {"unit": "m2", "labor_rate": 1200, "productivity": 8, "material_share": 0.55, "default_qty_key": "floor_sq_m"},
    "flooring": {"unit": "m2", "labor_rate": 450, "productivity": 15, "material_share": 0.50, "default_qty_key": "floor_sq_m"},
    "floor_screed": {"unit": "m2", "labor_rate": 650, "productivity": 20, "material_share": 0.45, "default_qty_key": "floor_sq_m"},
    "demolition": {"unit": "m2", "labor_rate": 120, "productivity": 30, "material_share": 0.05, "default_qty_key": "floor_sq_m"},
    "waste": {"unit": "trip", "labor_rate": 5000, "productivity": 1, "material_share": 0.0, "default_qty_key": "trips"},
    "waste_removal": {"unit": "trip", "labor_rate": 5000, "productivity": 1, "material_share": 0.0, "default_qty_key": "trips"},
    "furniture": {"unit": "pcs", "labor_rate": 2500, "productivity": 4, "material_share": 0.60, "default_qty_key": "pcs"},
    "custom": {"unit": "m2", "labor_rate": 400, "productivity": 10, "material_share": 0.40, "default_qty_key": "floor_sq_m"},
}
SEASONAL = [0.92, 0.93, 1.0, 1.05, 1.08, 1.06, 1.04, 1.03, 1.07, 1.06, 0.98, 0.94]
