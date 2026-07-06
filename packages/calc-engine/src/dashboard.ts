import type { ProjectDashboard } from './types';

/** Метрики главного экрана — план vs факт, прогресс, просрочка */
export function calcProjectDashboard(params: {
  stages: { weight: number; percentComplete: number }[];
  budgetPlanned: number;
  budgetSpent: number;
  materialPlanned: number;
  materialSpent: number;
  plannedEndDate: Date;
  now?: Date;
}): ProjectDashboard {
  const now = params.now ?? new Date();
  const totalWeight = params.stages.reduce((s, st) => s + st.weight, 0) || 1;
  const progressPercent = round2(
    params.stages.reduce((s, st) => s + st.weight * (st.percentComplete / 100), 0) / totalWeight * 100,
  );

  const budgetVariancePercent =
    params.budgetPlanned > 0
      ? round2(((params.budgetSpent - params.budgetPlanned) / params.budgetPlanned) * 100)
      : 0;

  const materialOverrunPercent =
    params.materialPlanned > 0
      ? round2(((params.materialSpent - params.materialPlanned) / params.materialPlanned) * 100)
      : 0;

  const msPerDay = 86400000;
  const daysOverdue = Math.max(
    0,
    Math.floor((now.getTime() - params.plannedEndDate.getTime()) / msPerDay),
  );

  return {
    progressPercent,
    budgetPlanned: params.budgetPlanned,
    budgetSpent: params.budgetSpent,
    budgetVariancePercent,
    materialOverrunPercent,
    daysOverdue,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
