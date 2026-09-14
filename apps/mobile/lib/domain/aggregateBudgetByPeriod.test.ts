import { allocateEvenly, buildPeriodBuckets, filterRowsByPeriod, sumRows, plannedShareForPeriod } from './aggregateBudgetByPeriod';
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

// Date-independent: project window always spans "today".
const today = new Date();
const winStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
const winEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().slice(0, 10);
const share = plannedShareForPeriod(120000, 'month', winStart, winEnd);
if (!(share > 0 && share < 120000)) throw new Error('planned share');

// #318 / B0-5: bucket plans must sum exactly to the period plan (largest-remainder allocation).
for (const [total, count] of [[100000, 5], [100000, 4], [7, 3], [0, 12], [1, 31]] as const) {
  const parts = allocateEvenly(total, count);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (parts.length !== count || sum !== total) throw new Error(`allocateEvenly ${total}/${count} -> ${parts}`);
  if (Math.max(...parts) - Math.min(...parts) > 1) throw new Error(`allocateEvenly uneven ${parts}`);
}
for (const period of ['week', 'month', 'year'] as const) {
  const buckets = buildPeriodBuckets([], period, 100000, winStart, winEnd);
  const expected = Math.round(plannedShareForPeriod(100000, period, winStart, winEnd));
  const got = buckets.reduce((a, b) => a + b.planned, 0);
  if (got !== expected) throw new Error(`${period}: buckets=${buckets.length} sum=${got} expected=${expected}`);
}

console.log('aggregateBudgetByPeriod.test OK');
