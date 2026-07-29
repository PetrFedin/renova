import type { StageDetail } from '@/lib/api';
import {
  buildStageContextSummary,
  isStageOverdue,
  localIsoDate,
  stageContextPriorityTarget,
} from './stageContextSummary';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const base: StageDetail = {
  id: 's1',
  name: 'Санузел',
  status: 'active',
  percent_complete: 20,
  payment_amount: 120000,
  sort_order: 1,
  comments: [],
  photos: [],
  notes: null,
  contractor_ready_at: null,
};

check(buildStageContextSummary({ ...base, needs_rework: true }).priority === 'issue', 'rework is an issue');
check(
  buildStageContextSummary({ ...base, status: 'review', planned_end: '2020-01-01', works_total: 3, works_done: 1 }).priority === 'acceptance',
  'acceptance outranks overdue work',
);
check(
  buildStageContextSummary({ ...base, planned_end: '2020-01-01', works_total: 3, works_done: 1 }).priority === 'work',
  'overdue unfinished work',
);
check(buildStageContextSummary({ ...base, budget_alert_pct: 101 }).priority === 'budget', 'real budget overrun');
check(buildStageContextSummary({ ...base, budget_alert_pct: 100 }).priority === 'none', '100 percent is not an overrun');
check(buildStageContextSummary({ ...base, planned_end: '2099-01-01' }).priority === 'schedule', 'valid deadline');
check(buildStageContextSummary({ ...base, planned_end: null }).priority === 'none', 'no false action');

check(!isStageOverdue({ planned_end: '2020-01-01', status: 'done', works_total: 3, works_done: 1 }, '2026-07-29'), 'done is not overdue');
check(!isStageOverdue({ planned_end: '2020-01-01', status: 'cancelled', works_total: 3, works_done: 1 }, '2026-07-29'), 'cancelled is not overdue');
check(!isStageOverdue({ planned_end: '2026-02-30', status: 'active', works_total: 3, works_done: 1 }, '2026-07-29'), 'invalid date is unknown');
check(!isStageOverdue({ planned_end: '2020-01-01', status: 'active', works_total: undefined, works_done: undefined }, '2026-07-29'), 'missing work counts are not overdue');
check(localIsoDate(new Date(2026, 6, 29, 23, 30)) === '2026-07-29', 'today uses local calendar date');

const normalized = buildStageContextSummary({
  ...base,
  payment_amount: Number.NaN,
  works_total: -2,
  works_done: 7,
  room_ids: undefined,
  comments: undefined,
  photos: undefined,
});
check(normalized.payableAmount === null, 'unknown payment is null');
check(normalized.worksOpen === 0, 'open work cannot be negative');
check(normalized.rooms === 0 && normalized.comments === 0 && normalized.photos === 0, 'missing arrays are empty');
check(buildStageContextSummary({ ...base, payment_amount: -1 }).payableAmount === null, 'negative payment is not payable');
check(buildStageContextSummary({ ...base, status: 'completed', planned_end: '2020-01-01', works_total: 3, works_done: 1 }).priority === 'none', 'completed stage has no CTA');

for (const role of ['customer', 'contractor'] as const) {
  check(stageContextPriorityTarget('issue', role, 's1')?.params?.filter === 'stage:s1', `${role} issue route`);
  check(stageContextPriorityTarget('work', role, 's1')?.params?.filter === 'stage:s1', `${role} work route`);
  check(stageContextPriorityTarget('acceptance', role, 's1')?.params?.stageId === 's1', `${role} acceptance route`);
  check(stageContextPriorityTarget('acceptance', role, 's1')?.params?.filter === 'acceptance', `${role} acceptance filter`);
  check(stageContextPriorityTarget('budget', role, 's1')?.params?.stageId === 's1', `${role} budget route`);
  check(stageContextPriorityTarget('schedule', role, 's1')?.params?.stageId === 's1', `${role} schedule route`);
  check(stageContextPriorityTarget('none', role, 's1') === null, `${role} no false CTA`);
}

console.log('stageContextSummary.test OK');
