import { buildStageContextSummary, isStageOverdue, stageContextPriorityTarget } from './stageContextSummary';
import type { StageDetail } from '@/lib/api';

const base: StageDetail = { id: 's1', name: 'Санузел', status: 'active', percent_complete: 20, payment_amount: 120000, sort_order: 1, comments: [], photos: [], notes: null, contractor_ready_at: null };
function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

check(buildStageContextSummary({ ...base, needs_rework: true }).priority === 'issue', 'issue priority');
check(buildStageContextSummary({ ...base, planned_end: '2020-01-01', works_total: 3, works_done: 1 }).priority === 'work', 'overdue work priority');
check(buildStageContextSummary({ ...base, status: 'review', planned_end: null }).priority === 'acceptance', 'acceptance priority');
check(buildStageContextSummary({ ...base, budget_alert_pct: 100, planned_end: null }).priority === 'budget', 'budget priority');
check(buildStageContextSummary({ ...base, planned_end: '2099-01-01' }).priority === 'schedule', 'schedule priority');
check(buildStageContextSummary({ ...base, planned_end: null }).priority === 'none', 'none priority');
check(buildStageContextSummary({ ...base, works_total: 1, works_done: 4 }).worksOpen === 0, 'works do not go negative');
check(buildStageContextSummary({ ...base, comments: [{ id: 'c', text: 'проблем нет', author_role: 'customer', created_at: '' }] }).priority === 'none', 'comments are not QC issues');
check(buildStageContextSummary({ ...base, planned_end: 'not-a-date' }).priority === 'none', 'malformed date is unknown');
check(!isStageOverdue({ planned_end: '2020-01-01', status: 'done', works_total: 3, works_done: 1 }), 'done stage is not overdue');
check(!isStageOverdue({ planned_end: '2020-01-01', status: 'active', works_total: undefined, works_done: undefined }), 'missing work counts are not overdue');
check(buildStageContextSummary({ ...base, payment_amount: Number.NaN }).payableAmount === null, 'unknown payment is null');

for (const role of ['customer', 'contractor'] as const) {
  check(stageContextPriorityTarget('issue', role, 's1')?.params?.filter === 'stage:s1', `${role} issue route`);
  check(stageContextPriorityTarget('work', role, 's1')?.params?.filter === 'stage:s1', `${role} work route`);
  check(stageContextPriorityTarget('acceptance', role, 's1')?.params?.stageId === 's1', `${role} acceptance route`);
  check(stageContextPriorityTarget('budget', role, 's1')?.params?.stageId === 's1', `${role} budget route`);
  check(stageContextPriorityTarget('schedule', role, 's1')?.params?.stageId === 's1', `${role} schedule route`);
  check(stageContextPriorityTarget('none', role, 's1') === null, `${role} no false CTA`);
}
console.log('stageContextSummary.test OK');
