/** Project Health Score 0–100 из реальных данных проекта */
import type { ProjectHealthLevel } from './osTypes';

export function computeProjectHealth(input: {
  budgetPlanned: number;
  budgetSpent: number;
  progressPercent: number;
  overdueStages: number;
  reviewStages: number;
  reworkStages: number;
  materialsNeedBuy: number;
  materialsShortage: number;
  pendingPayments: number;
  budgetAlerts: number;
}): { score: number; level: ProjectHealthLevel; label: string; factors: string[] } {
  const factors: string[] = [];
  let budget = 100;
  if (input.budgetPlanned > 0) {
    const ratio = input.budgetSpent / input.budgetPlanned;
    if (ratio > 1) { budget = 40; factors.push('перерасход бюджета'); }
    else if (ratio > 0.92) { budget = 65; factors.push('бюджет почти исчерпан'); }
    else if (ratio > 0.85) { budget = 80; }
  }
  let schedule = 100;
  if (input.overdueStages > 0) {
    schedule = Math.max(35, 100 - input.overdueStages * 18);
    factors.push('есть просрочки');
  }
  let materials = 100;
  if (input.materialsShortage > 0) {
    materials = Math.max(40, 100 - input.materialsShortage * 15);
    factors.push('не хватает материалов');
  } else if (input.materialsNeedBuy > 3) {
    materials = 75;
    factors.push('много позиций к закупке');
  }
  let quality = 100;
  if (input.reworkStages > 0) { quality -= input.reworkStages * 20; factors.push('есть доработки'); }
  if (input.reviewStages > 2) { quality -= 10; factors.push('очередь приёмки'); }
  quality = Math.max(30, quality);
  let payments = input.pendingPayments > 0 ? Math.max(50, 100 - input.pendingPayments * 12) : 100;
  if (input.pendingPayments > 0) factors.push('ожидают оплаты');
  if (input.budgetAlerts > 0) { budget = Math.min(budget, 70); factors.push('риск по смете'); }

  const score = Math.round(budget * 0.28 + schedule * 0.24 + materials * 0.18 + quality * 0.18 + payments * 0.12);
  let level: ProjectHealthLevel = 'good';
  if (score < 60) level = 'critical';
  else if (score < 75) level = 'risk';
  else if (score < 90) level = 'attention';

  const label =
    level === 'good' ? 'Хорошо' :
    level === 'attention' ? 'Есть риски' :
    level === 'risk' ? 'Требует внимания' : 'Критично';

  return { score, level, label, factors: [...new Set(factors)].slice(0, 4) };
}

/** Прогноз итоговой стоимости — без «+1.3 млн» при малом % выполнения */
export function forecastFinalCost(planned: number, spent: number, progressPercent: number): number {
  if (planned <= 0) return 0;
  if (progressPercent <= 15 || spent <= 0) return planned;
  const runRate = spent / Math.max(progressPercent, 1);
  const raw = Math.round(runRate * 100);
  return Math.min(raw, Math.round(planned * 1.35));
}

/** Риск перерасхода для UI — не выше разумного порога */
export function capOverrunRisk(overrun: number, planned: number): number {
  if (overrun <= 0 || planned <= 0) return 0;
  return Math.min(overrun, Math.round(planned * 0.35));
}
