/** Сводка по статьям бюджета — несколько проектов */
import type { BudgetBreakdown } from '@/lib/api';

export type PortfolioCategoryRow = {
  key: string;
  label: string;
  planned: number;
  spent: number | null;
  variance: number | null;
  variancePct: number | null;
  hasOverrun: boolean;
};

function categoryLine(key: string, label: string, planned: number, spent: number | null): PortfolioCategoryRow {
  const variance = spent == null ? null : spent - planned;
  const variancePct = spent == null || planned <= 0 ? null : Math.round((variance! / planned) * 100);
  return {
    key,
    label,
    planned,
    spent,
    variance,
    variancePct,
    hasOverrun: planned > 0 && variance != null && variance > 0,
  };
}

export function aggregatePortfolioBudgetBreakdowns(breakdowns: BudgetBreakdown[]): PortfolioCategoryRow[] {
  let works = 0;
  let materialsPlan = 0;
  let materialsFact = 0;
  let waste = 0;
  let reserve = 0;
  let totalPlan = 0;
  let totalSpent = 0;

  for (const b of breakdowns) {
    works += b.works || 0;
    materialsPlan += b.materials_plan || 0;
    materialsFact += b.materials_fact || 0;
    waste += b.waste || 0;
    reserve += b.reserve || 0;
    totalPlan += b.budget_planned || 0;
    totalSpent += b.budget_spent || 0;
  }

  // The current breakdown contract exposes a real material calculation and the
  // authoritative project total, but not independent actuals for works/waste/reserve.
  // Never manufacture a zero variance by copying plan into fact.
  const lines = [
    categoryLine('works', 'Работы (смета)', works, null),
    categoryLine('materials', 'Материалы', materialsPlan, materialsFact),
    categoryLine('waste', 'Вывоз мусора', waste, null),
    categoryLine('reserve', 'Резерв', reserve, null),
    categoryLine('total', 'Итого по бюджету', totalPlan, totalSpent),
  ];

  return lines.filter((line) => line.planned > 0 || (line.spent ?? 0) > 0);
}
