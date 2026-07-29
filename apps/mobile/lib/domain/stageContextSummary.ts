import type { StageDetail } from '@/lib/api';
import type { OsRole, OsTabRoute } from '@/constants/osSections';
import { budgetTabRoute, calendarTabRoute, repairTabRoute, tabsRoute } from '@/constants/osSections';

export type StageContextPriority = 'issue' | 'acceptance' | 'work' | 'budget' | 'schedule' | 'none';

type StageContextInput = Pick<
  StageDetail,
  'id' | 'status' | 'planned_end' | 'works_total' | 'works_done' | 'needs_rework' | 'budget_alert_pct' | 'payment_amount'
> & Partial<Pick<StageDetail, 'room_ids' | 'comments' | 'photos'>>;

export type StageContextSummary = {
  rooms: number;
  worksOpen: number;
  comments: number;
  photos: number;
  payableAmount: number | null;
  plannedEnd: string | null;
  priority: StageContextPriority;
};

const TERMINAL_STAGE_STATUSES = new Set(['done', 'cancelled', 'completed', 'accepted']);

function nonNegativeInteger(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value as number));
}

function parseIsoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return value;
}

export function localIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isTerminalStageStatus(status: string | null | undefined): boolean {
  return TERMINAL_STAGE_STATUSES.has((status || '').toLowerCase());
}

export function isStageOverdue(
  stage: Pick<StageContextInput, 'planned_end' | 'status' | 'works_total' | 'works_done'>,
  today = localIsoDate(),
): boolean {
  const plannedEnd = parseIsoDate(stage.planned_end);
  const todayIso = parseIsoDate(today);
  if (!plannedEnd || !todayIso || isTerminalStageStatus(stage.status)) return false;
  const total = nonNegativeInteger(stage.works_total);
  const done = nonNegativeInteger(stage.works_done);
  return total > done && plannedEnd < todayIso;
}

export function buildStageContextSummary(stage: StageContextInput): StageContextSummary {
  const worksTotal = nonNegativeInteger(stage.works_total);
  const worksDone = nonNegativeInteger(stage.works_done);
  const worksOpen = Math.max(0, worksTotal - worksDone);
  const plannedEnd = parseIsoDate(stage.planned_end);
  const terminal = isTerminalStageStatus(stage.status);
  const budgetUsagePct = Number.isFinite(stage.budget_alert_pct) ? Number(stage.budget_alert_pct) : null;

  const priority: StageContextPriority = terminal
    ? 'none'
    : stage.needs_rework
      ? 'issue'
      : stage.status === 'review'
        ? 'acceptance'
        : isStageOverdue(stage)
          ? 'work'
          : budgetUsagePct != null && budgetUsagePct > 100
            ? 'budget'
            : plannedEnd
              ? 'schedule'
              : 'none';

  const paymentAmount = Number(stage.payment_amount);

  return {
    rooms: stage.room_ids?.length ?? 0,
    worksOpen,
    comments: stage.comments?.length ?? 0,
    photos: stage.photos?.length ?? 0,
    payableAmount: Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : null,
    plannedEnd,
    priority,
  };
}

export function stageContextPriorityTarget(
  priority: StageContextPriority,
  role: OsRole,
  stageId: string,
): OsTabRoute | null {
  switch (priority) {
    case 'issue':
      return repairTabRoute(role, 'control', `stage:${stageId}`);
    case 'acceptance':
      return tabsRoute(role, 'repair', 'control', { filter: 'acceptance', stageId });
    case 'work':
      return repairTabRoute(role, 'works', `stage:${stageId}`);
    case 'budget':
      return budgetTabRoute(role, 'deviations', { stageId });
    case 'schedule':
      return calendarTabRoute(role, { stageId });
    case 'none':
      return null;
  }
}
