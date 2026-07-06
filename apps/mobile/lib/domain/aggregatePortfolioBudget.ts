/** Сводка по статьям бюджета — несколько проектов */
import type { BudgetBreakdown } from '@/lib/api';

export type PortfolioCategoryRow = {
  key: string;
  label: string;
  planned: number;
  spent: number;
  variance: number;
  variancePct: number;
  hasOverrun: boolean;
};

function categoryLine(key: string, label: string, planned: number, spent: number): PortfolioCategoryRow {
  const variance = spent - planned;
  const variancePct = planned > 0 ? Math.round((variance / planned) * 100) : 0;
  return {
    key,
    label,
    planned,
    spent,
    variance,
    variancePct,
    hasOverrun: planned > 0 && variance > 0,
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

  const lines = [
    categoryLine('works', 'Работы (смета)', works, works),
    categoryLine('materials', 'Материалы', materialsPlan, materialsFact),
    categoryLine('waste', 'Вывоз мусора', waste, waste),
    categoryLine('reserve', 'Резерв', reserve, reserve),
    categoryLine('total', 'Итого по бюджету', totalPlan, totalSpent),
  ];

  return lines.filter((l) => l.planned > 0 || l.spent > 0);
}
