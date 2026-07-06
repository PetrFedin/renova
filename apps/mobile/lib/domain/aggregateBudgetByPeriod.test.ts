import { filterRowsByPeriod, sumRows, plannedShareForPeriod } from './aggregateBudgetByPeriod';
import type { ExpenseDetailRow } from './expenseAnalytics';

const now = new Date('2026-06-20T12:00:00');
const rows: ExpenseDetailRow[] = [
  { id: '1', date: '2026-06-01', title: 'A', amount: 1000, category: 'm', categoryLabel: 'M', kind: 'receipt', hasDocument: true },
  { id: '2', date: '2026-06-15', title: 'B', amount: 2000, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: '3', date: '2025-01-01', title: 'Old', amount: 500, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
];

const june = filterRowsByPeriod(rows, 'month', now);
if (june.length !== 2) throw new Error('month filter');
if (sumRows(june) !== 3000) throw new Error('month sum');

const share = plannedShareForPeriod(120000, 'month', '2026-06-01', '2026-08-31');
if (!(share > 0 && share < 120000)) throw new Error('planned share');

console.log('aggregateBudgetByPeriod.test OK');
