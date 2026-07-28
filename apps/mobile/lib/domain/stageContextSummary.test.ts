import { buildStageContextSummary } from './stageContextSummary';
const base = { id: 's1', name: 'Санузел', status: 'active', percent_complete: 20, payment_amount: 120000, sort_order: 1, comments: [], photos: [] } as const;
const critical = buildStageContextSummary({ ...base, needs_rework: true, works_total: 2, works_done: 2 });
console.assert(critical.priority === 'issue', 'critical issue has priority');
const overdue = buildStageContextSummary({ ...base, planned_end: '2020-01-01', works_total: 3, works_done: 1 });
console.assert(overdue.priority === 'work' && overdue.worksOpen === 2, 'overdue work has priority');
const acceptance = buildStageContextSummary({ ...base, status: 'review', planned_end: null });
console.assert(acceptance.priority === 'acceptance', 'review stage has acceptance priority');
console.log('stageContextSummary.test OK');
