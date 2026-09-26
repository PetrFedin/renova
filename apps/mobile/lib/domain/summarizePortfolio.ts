/** Агрегаты портфеля — план, факт, перерасход/экономия */
import type { ProjectSummary } from '@/lib/api';
import { buildPortfolioProjectRows, type PortfolioProjectRow } from '@/lib/domain/portfolioProjects';

export type PortfolioSummary = {
  count: number;
  totalPlan: number;
  totalSpent: number;
  /** spent - planned */
  variance: number;
  variancePct: number;
  /**
   * Экономия — только по завершённым проектам.
   *
   * Непотраченный бюджет незавершённого проекта экономией не является: он ещё
   * будет потрачен. Раньше savings = max(0, план − факт) по всему портфелю, из-за
   * чего новый объект с нулевыми тратами показывал «Экономия 254 868 ₽ (−100%)».
   */
  savings: number;
  /** Процент экономии от плана завершённых проектов (не от всего портфеля). */
  savingsPct: number;
  /** Непотраченный остаток по всему портфелю — это не экономия. */
  remaining: number;
  /** Перерасход сверх плана */
  overspend: number;
  /** Доля факта от плана, % */
  spendPct: number;
  projectsOver: number;
  projectsUnder: number;
  projectsOnTrack: number;
  /** @deprecated Используйте completedCount — средний % работ запутывает клиента */
  avgProgress: number;
  completedCount: number;
  inProgressCount: number;
  rows: PortfolioProjectRow[];
};

export function summarizePortfolio(
  projects: Pick<
    ProjectSummary,
    'id' | 'name' | 'budget_planned' | 'budget_spent' | 'progress_percent' | 'pending_payments'
  >[],
  pendingById: Record<string, number> = {},
): PortfolioSummary {
  const rows = buildPortfolioProjectRows(projects, pendingById);
  const count = rows.length;
  const totalPlan = rows.reduce((a, r) => a + r.planned, 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);
  const variance = totalSpent - totalPlan;
  const variancePct = totalPlan > 0 ? Math.round((variance / totalPlan) * 100) : 0;
  // Экономия считается только там, где работа закончена. У незавершённого
  // проекта непотраченные деньги — остаток, а не экономия.
  const completedRows = rows.filter((r) => r.phaseLabel === 'Завершён');
  const completedPlan = completedRows.reduce((a, r) => a + r.planned, 0);
  const completedSpent = completedRows.reduce((a, r) => a + r.spent, 0);
  const savings = Math.max(0, completedPlan - completedSpent);
  const savingsPct = completedPlan > 0 ? Math.round((savings / completedPlan) * 100) : 0;
  const remaining = Math.max(0, totalPlan - totalSpent);
  const overspend = Math.max(0, totalSpent - totalPlan);
  const spendPct = totalPlan > 0 ? Math.round((totalSpent / totalPlan) * 100) : 0;
  const avgProgress = count
    ? Math.round(rows.reduce((a, r) => a + r.progressPercent, 0) / count)
    : 0;

  return {
    count,
    totalPlan,
    totalSpent,
    variance,
    variancePct,
    savings,
    savingsPct,
    remaining,
    overspend,
    spendPct,
    projectsOver: rows.filter((r) => r.status === 'over').length,
    projectsUnder: rows.filter((r) => r.status === 'under').length,
    projectsOnTrack: rows.filter((r) => r.status === 'on_track').length,
    avgProgress,
    completedCount: rows.filter((r) => r.phaseLabel === 'Завершён').length,
    inProgressCount: rows.filter((r) => r.phaseLabel !== 'Завершён').length,
    rows,
  };
}
