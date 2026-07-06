/** Регионы для рыночной оценки бюджета */
export type RegionOption = { code: string; name: string; labor_index: number; material_index: number };

export const REGIONS_FALLBACK: RegionOption[] = [
  { code: 'moscow', name: 'Москва и МО', labor_index: 1.0, material_index: 1.0 },
  { code: 'spb', name: 'Санкт-Петербург', labor_index: 0.95, material_index: 0.98 },
  { code: 'kazan', name: 'Казань', labor_index: 0.78, material_index: 0.88 },
  { code: 'ekb', name: 'Екатеринбург', labor_index: 0.82, material_index: 0.90 },
  { code: 'novosibirsk', name: 'Новосибирск', labor_index: 0.80, material_index: 0.87 },
  { code: 'krasnodar', name: 'Краснодар', labor_index: 0.85, material_index: 0.92 },
  { code: 'other', name: 'Другой регион', labor_index: 0.88, material_index: 0.90 },
];

export type MarketEstimateLine = {
  work_type: string;
  qty: number;
  unit: string;
  labor: number;
  materials: number;
  days: number;
};

export type MarketConsumable = {
  name: string;
  unit: string;
  qty: number;
  category: string;
  estimated_price: number;
  total: number;
  note?: string;
};

export type LemanaSuggestion = {
  name: string;
  unit: string;
  avg_price: number;
  shop_name: string;
  shop_url: string;
  source: string;
};

export type PriceTrendPoint = { month: string; label: string; total: number; index: number };

export type MarketEstimate = {
  region: RegionOption;
  complexity: number;
  labor_total: number;
  materials_total: number;
  labor_share: number;
  materials_share: number;
  days_estimated: number;
  reserve: number;
  grand_total: number;
  lines: MarketEstimateLine[];
  consumables: MarketConsumable[];
  lemana_suggestions: LemanaSuggestion[];
  price_trend_6m: PriceTrendPoint[];
  disclaimer: string;
};

export type BudgetPlanInput = {
  region_code: string;
  work_types: string[];
  floor_sq_m: number;
  wall_sq_m: number;
  perimeter_m: number;
  outlets_count?: number;
  plumbing_points?: number;
  complexity?: number;
  labor_share?: number | null;
};

/** Клиентская прикидка если API недоступен */
export function fallbackMarketEstimate(input: BudgetPlanInput): MarketEstimate {
  const reg = REGIONS_FALLBACK.find((r) => r.code === input.region_code) || REGIONS_FALLBACK[0];
  const cx = input.complexity ?? 1;
  const area = input.floor_sq_m || 12;
  const laborBase = area * 450 * reg.labor_index * cx * input.work_types.length * 0.7;
  const matBase = area * 380 * reg.material_index * cx * input.work_types.length * 0.6;
  const labor = Math.round(laborBase);
  const materials = Math.round(matBase);
  const sub = labor + materials;
  return {
    region: reg,
    complexity: cx,
    labor_total: labor,
    materials_total: materials,
    labor_share: labor / sub,
    materials_share: materials / sub,
    days_estimated: Math.max(1, Math.round(area / 8 * input.work_types.length)),
    reserve: Math.round(sub * 0.05),
    grand_total: Math.round(sub * 1.05),
    lines: input.work_types.map((wt) => ({ work_type: wt, qty: area, unit: 'm2', labor: labor / input.work_types.length, materials: materials / input.work_types.length, days: 2 })),
    consumables: [],
    lemana_suggestions: [],
    price_trend_6m: [],
    disclaimer: 'Офлайн-оценка. Подключите backend для точного расчёта.',
  };
}
