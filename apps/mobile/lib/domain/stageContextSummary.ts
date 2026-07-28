import type { StageDetail } from '@/lib/api';
import type { OsRole, OsTabRoute } from '@/constants/osSections';
import { budgetTabRoute, calendarTabRoute, repairTabRoute, tabsRoute } from '@/constants/osSections';

export type StageContextPriority = 'issue' | 'work' | 'acceptance' | 'budget' | 'schedule' | 'none';

export type StageContextSummary = {
  rooms: number;
  worksOpen: number;
  comments: number;
  photos: number;
  payableAmount: number | null;
  priority: StageContextPriority;
};

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function isStageOverdue(stage: Pick<StageDetail, 'planned_end' | 'status' | 'works_total' | 'works_done'>, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!isIsoDate(stage.planned_end) || !isIsoDate(today)) return false;
  if (stage.status === 'done' || stage.status === 'cancelled') return false;
  return (stage.works_total ?? 0) > (stage.works_done ?? 0) && stage.planned_end < today;
}

export function buildStageContextSummary(stage: StageDetail): StageContextSummary {
  const worksOpen = Math.max(0, (stage.works_total ?? 0) - (stage.works_done ?? 0));
  const priority: StageContextPriority = stage.needs_rework
    ? 'issue'
    : isStageOverdue(stage)
      ? 'work'
      : stage.status === 'review'
        ? 'acceptance'
        : stage.budget_alert_pct != null && stage.budget_alert_pct >= 100
          ? 'budget'
          : isIsoDate(stage.planned_end)
            ? 'schedule'
            : 'none';
  return {
    rooms: stage.room_ids?.length ?? 0,
    worksOpen,
    comments: stage.comments.length,
    photos: stage.photos.length,
    payableAmount: Number.isFinite(stage.payment_amount) ? stage.payment_amount : null,
    priority,
  };
}

export function stageContextPriorityTarget(priority: StageContextPriority, role: OsRole, stageId: string): OsTabRoute | null {
  switch (priority) {
    case 'issue': return repairTabRoute(role, 'control', `stage:${stageId}`);
    case 'work': return repairTabRoute(role, 'works', `stage:${stageId}`);
    case 'acceptance': return tabsRoute(role, 'repair', 'control', { filter: 'acceptance', stageId });
    case 'budget': return budgetTabRoute(role, 'deviations', { stageId });
    case 'schedule': return calendarTabRoute(role, { stageId });
    case 'none': return null;
  }
}
