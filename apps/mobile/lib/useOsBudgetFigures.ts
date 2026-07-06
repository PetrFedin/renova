/** Единый источник plan/fact для UI — osBudget с fallback на project */
import type { OsBudgetSummary, ProjectDetail } from '@/lib/api';

export type BudgetFigures = {
  planned: number;
  spent: number;
  variancePercent?: number;
};

export function resolveBudgetFigures(
  project: ProjectDetail | null | undefined,
  osBudget: OsBudgetSummary | null | undefined,
): BudgetFigures {
  if (osBudget) {
    return {
      planned: osBudget.budget_planned,
      spent: osBudget.budget_spent,
      variancePercent: osBudget.deviation_pct,
    };
  }
  return {
    planned: project?.budget_planned || 0,
    spent: project?.budget_spent || 0,
  };
}
