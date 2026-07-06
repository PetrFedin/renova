"""Региональные индексы стоимости ремонта (база — Москва = 1.0)."""
REGIONS = [
    {"code": "moscow", "name": "Москва и МО", "labor_index": 1.0, "material_index": 1.0},
    {"code": "spb", "name": "Санкт-Петербург", "labor_index": 0.95, "material_index": 0.98},
    {"code": "kazan", "name": "Казань", "labor_index": 0.78, "material_index": 0.88},
    {"code": "ekb", "name": "Екатеринбург", "labor_index": 0.82, "material_index": 0.90},
    {"code": "novosibirsk", "name": "Новосибирск", "labor_index": 0.80, "material_index": 0.87},
    {"code": "krasnodar", "name": "Краснодар", "labor_index": 0.85, "material_index": 0.92},
    {"code": "other", "name": "Другой регион", "labor_index": 0.88, "material_index": 0.90},
]
REGION_BY_CODE = {r["code"]: r for r in REGIONS}
