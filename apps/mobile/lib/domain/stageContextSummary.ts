import type { StageDetail } from '@/lib/api';

export type StageContextPriority = 'issue' | 'work' | 'acceptance' | 'budget' | 'schedule' | 'none';

export type StageContextSummary = {
  rooms: number;
  worksOpen: number;
  comments: number;
  photos: number;
  budgetAmount: number;
  priority: StageContextPriority;
};

export function buildStageContextSummary(stage: StageDetail): StageContextSummary {
  const worksOpen = Math.max(0, (stage.works_total ?? 0) - (stage.works_done ?? 0));
  const priority: StageContextPriority = stage.needs_rework || stage.comments.some((c) => /проблем|критич|замеч/i.test(c.text))
    ? 'issue'
    : worksOpen > 0 && Boolean(stage.planned_end && stage.planned_end < new Date().toISOString().slice(0, 10))
      ? 'work'
      : stage.status === 'review'
        ? 'acceptance'
        : stage.budget_alert_pct != null && stage.budget_alert_pct >= 100
          ? 'budget'
          : stage.planned_end
            ? 'schedule'
            : 'none';
  return {
    rooms: stage.room_ids?.length ?? 0,
    worksOpen,
    comments: stage.comments.length,
    photos: stage.photos.length,
    budgetAmount: stage.payment_amount,
    priority,
  };
}
