/**
 * Единый SoT счётчиков задач (dock calendar / inbox / overdue).
 * Не считать dueToday по календарю, а actionRequired по UI-строкам независимо.
 */
export type TaskType =
  | 'calendar'
  | 'acceptance'
  | 'selection'
  | 'payment'
  | 'change_order'
  | 'approval'
  | 'warranty'
  | 'quality'
  | 'schedule'
  | 'document'
  | 'overdue'
  | string;

export type TaskCounters = {
  dueToday: number;
  overdue: number;
  upcoming: number;
  actionRequired: number;
  byType: Record<TaskType, number>;
  revision: string | number;
  asOfDate?: string;
  timezone?: string;
  projectId?: string;
  role?: string;
};

export type TaskCountersSnapshot = TaskCounters & {
  contextKey: string;
  updatedAt: number;
};

export function emptyTaskCounters(partial?: Partial<TaskCounters>): TaskCounters {
  return {
    dueToday: 0,
    overdue: 0,
    upcoming: 0,
    actionRequired: 0,
    byType: {},
    revision: 0,
    ...partial,
  };
}

/** Применить snapshot только если revision новее (stale response drop). */
export function shouldApplyTaskCounters(
  current: TaskCounters | null,
  incoming: TaskCounters,
): boolean {
  if (!current) return true;
  const a = Number(current.revision) || 0;
  const b = Number(incoming.revision) || 0;
  return b >= a;
}

/**
 * Безопасный delta: если revision новее — можно merge byType;
 * иначе игнор (повторная доставка / stale).
 */
export function applyTaskCounterDelta(
  current: TaskCounters | null,
  opts: {
    revision: string | number;
    counter_delta?: Partial<Record<TaskType, number>> | Record<string, number>;
  },
): TaskCounters | null {
  if (!current) return null;
  const curRev = Number(current.revision) || 0;
  const nextRev = Number(opts.revision) || 0;
  // Только строго более новая revision (повторная доставка / stale — игнор)
  if (nextRev <= curRev) return current;

  const delta = opts.counter_delta || {};
  const byType = { ...current.byType };
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v !== 'number') continue;
    byType[k] = Math.max(0, (byType[k] || 0) + v);
  }
  const dueToday = typeof delta.calendar === 'number'
    ? Math.max(0, current.dueToday + delta.calendar)
    : current.dueToday;
  const overdue = typeof delta.overdue === 'number'
    ? Math.max(0, current.overdue + delta.overdue)
    : current.overdue;

  // actionRequired: пересчитать категории (как на сервере)
  const actionKinds = [
    'acceptance', 'selection', 'payment', 'change_order',
    'warranty', 'quality', 'schedule', 'document',
  ];
  let actionRequired = actionKinds.reduce((n, k) => n + ((byType[k] || 0) > 0 ? 1 : 0), 0);
  if (overdue > 0) actionRequired += 1;

  return {
    ...current,
    dueToday,
    overdue,
    byType,
    actionRequired,
    revision: nextRev,
  };
}

/** Семантика badge: calendar = dueToday; inbox tasks = actionRequired */
export const TASK_COUNTER_BADGE = {
  calendar: 'dueToday' as const,
  inboxTasks: 'actionRequired' as const,
  overdueSeparate: true as const,
};

export function taskCountersContextKey(
  projectId: string | null | undefined,
  role: string | null | undefined,
  timezone: string,
): string {
  return `tasks:${projectId || ''}:${role || ''}:${timezone}`;
}
