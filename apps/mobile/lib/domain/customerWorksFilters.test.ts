import { filterStagesForCustomer, CUSTOMER_WORKS_FILTERS } from './customerWorksFilters';
import type { Stage } from '../api';

const today = '2026-06-01';
const stages = [
  { id: '1', status: 'review', sort_order: 1, needs_rework: false, planned_end: '2026-06-10' },
  { id: '2', status: 'done', sort_order: 2, needs_rework: false, planned_end: '2026-05-01' },
  { id: '3', status: 'active', sort_order: 3, needs_rework: false, planned_start: today },
] as unknown as Stage[];

const awaiting = filterStagesForCustomer(stages, 'awaiting', {}, today);
if (awaiting.length !== 1 || awaiting[0].id !== '1') throw new Error('awaiting filter');

const all = filterStagesForCustomer(stages, 'all', {}, today);
if (all.length !== 2) throw new Error('all excludes done');

if (CUSTOMER_WORKS_FILTERS.length !== 4) throw new Error('4 customer filters');

console.log('customerWorksFilters.test OK');
