import {
  filterStagesForCustomer,
  countStagesForCustomerFilters,
  CUSTOMER_WORKS_FILTERS,
} from './customerWorksFilters';
import type { Stage } from '../api';

const today = '2026-06-01';
const stages = [
  { id: 'review-ok', status: 'review', sort_order: 1, needs_rework: false, planned_end: '2026-06-10' },
  { id: 'done', status: 'done', sort_order: 2, needs_rework: false, planned_end: '2026-05-01' },
  { id: 'active-today', status: 'active', sort_order: 3, needs_rework: false, planned_start: today },
  { id: 'overdue', status: 'active', sort_order: 4, needs_rework: false, planned_end: '2026-05-20' },
  { id: 'rework', status: 'active', sort_order: 5, needs_rework: true, planned_end: '2026-06-15' },
  { id: 'review-late', status: 'review', sort_order: 6, needs_rework: false, planned_end: '2026-05-01' },
] as unknown as Stage[];

const awaiting = filterStagesForCustomer(stages, 'awaiting', {}, today);
if (awaiting.length !== 2 || !awaiting.every((s) => s.status === 'review')) {
  throw new Error('awaiting = только review');
}

const now = filterStagesForCustomer(stages, 'now', {}, today);
if (now.length !== 1 || now[0].id !== 'active-today') {
  throw new Error('now не должен включать review/problems');
}

const problems = filterStagesForCustomer(stages, 'problems', {}, today);
const problemIds = problems.map((s) => s.id).sort();
if (JSON.stringify(problemIds) !== JSON.stringify(['overdue', 'review-late', 'rework'].sort())) {
  throw new Error(`problems unexpected: ${problemIds.join(',')}`);
}

// review без просрочки не в problems
if (problems.some((s) => s.id === 'review-ok')) {
  throw new Error('чистая приёмка не должна быть в problems');
}

const all = filterStagesForCustomer(stages, 'all', {}, today);
if (all.length !== 5) throw new Error('all excludes done');

// Пересечения now ∩ awaiting ∩ problems (по id) должны быть пусты для now vs others
const nowIds = new Set(now.map((s) => s.id));
const awaitIds = new Set(awaiting.map((s) => s.id));
for (const id of nowIds) {
  if (awaitIds.has(id)) throw new Error('now ∩ awaiting');
  if (problems.some((s) => s.id === id)) throw new Error('now ∩ problems');
}

const counts = countStagesForCustomerFilters(stages, {}, today);
if (counts.now !== 1 || counts.awaiting !== 2 || counts.problems !== 3 || counts.all !== 5) {
  throw new Error(`counts ${JSON.stringify(counts)}`);
}

if (CUSTOMER_WORKS_FILTERS.length !== 4) throw new Error('4 customer filters');

console.log('customerWorksFilters.test OK');
