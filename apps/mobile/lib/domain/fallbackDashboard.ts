/** Минимальный dashboard из ProjectDetail — если API /dashboard недоступен */
import type { Dashboard, ProjectDetail } from '@/lib/api';
import { resolveProjectProgress } from './resolveProjectProgress';

export function fallbackDashboard(project: ProjectDetail): Dashboard {
  const planned = project.budget_planned || 0;
  const spent = project.budget_spent || 0;
  const variance = planned > 0 ? Math.round(((spent - planned) / planned) * 100) : 0;
  const stages = project.stages || [];
  const progress = resolveProjectProgress(stages, project.progress_percent || 0, null);
  const allDone = stages.length > 0 && stages.every((s) => s.status === 'done');
  const activeStage = stages.find((s) => s.status !== 'done');

  return {
    project_id: project.id,
    name: project.name,
    progress_percent: progress,
    budget_planned: planned,
    budget_spent: spent,
    budget_variance_percent: variance,
    days_overdue: 0,
    next_action_title: allDone
      ? 'Закрытие проекта'
      : activeStage
        ? `Этап: ${activeStage.name}`
        : 'Откройте раздел «Ремонт»',
    next_action_type: allDone ? 'payment' : 'work',
    alerts: planned > 0 && spent >= planned * 0.9 ? ['Бюджет близок к лимиту'] : [],
    planned_start_date: project.planned_start_date ?? null,
    planned_end_date: project.planned_end_date ?? null,
  };
}
