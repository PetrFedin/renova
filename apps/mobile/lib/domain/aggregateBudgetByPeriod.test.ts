import {
  buildPeriodBuckets,
  filterRowsByPeriod,
  plannedShareForPeriod,
  sumRows,
} from './aggregateBudgetByPeriod';
import type { ExpenseDetailRow } from './expenseAnalytics';

const now = new Date(2026, 5, 20, 12, 0, 0);
const rows: ExpenseDetailRow[] = [
  { id: '1', date: '2026-06-01', title: 'A', amount: 1000, category: 'm', categoryLabel: 'M', kind: 'receipt', hasDocument: true },
  { id: '2', date: '2026-06-15', title: 'B', amount: 2000, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: '3', date: '2025-01-01', title: 'Old', amount: 500, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: '4', date: '2026-06-29', title: 'Future in month', amount: 9000, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
];

const june = filterRowsByPeriod(rows, 'month', now);
if (june.length !== 2) throw new Error(`month filter: ${june.map((r) => r.id).join(',')}`);
if (sumRows(june) !== 3000) throw new Error('month sum');

const share = plannedShareForPeriod(120000, 'month', '2026-06-01', '2026-08-31', now);
if (!(share > 0 && share < 120000)) throw new Error('planned share');

// Regression #318: a five-week calendar month must never create 125% of period plan.
const fullMonthNow = new Date(2026, 8, 30, 12, 0, 0);
const fullMonthBuckets = buildPeriodBuckets([], 'month', 100000, '2026-09-01', '2026-09-30', fullMonthNow);
const fullMonthPlan = fullMonthBuckets.reduce((sum, bucket) => sum + bucket.planned, 0);
if (fullMonthBuckets.length !== 5) throw new Error(`expected five September buckets, got ${fullMonthBuckets.length}`);
if (Math.round(fullMonthPlan * 100) !== 10000000) throw new Error(`month plan not conserved: ${fullMonthPlan}`);

// Month means month-to-date: no future bucket and no future expense is silently included.
const monthToDateNow = new Date(2026, 8, 11, 12, 0, 0);
const monthRows: ExpenseDetailRow[] = [
  { id: 'past', date: '2026-09-03', title: 'Past', amount: 100, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: 'today', date: '2026-09-11', title: 'Today', amount: 200, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: 'future', date: '2026-09-29', title: 'Future', amount: 300, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
];
const monthToDateBuckets = buildPeriodBuckets(monthRows, 'month', 30000, '2026-09-01', '2026-09-30', monthToDateNow);
if (monthToDateBuckets.length !== 2) throw new Error(`month-to-date bucket count: ${monthToDateBuckets.length}`);
if (monthToDateBuckets.some((bucket) => bucket.rows.some((row) => row.id === 'future'))) throw new Error('future expense leaked into month-to-date');
const monthToDatePlanned = plannedShareForPeriod(30000, 'month', '2026-09-01', '2026-09-30', monthToDateNow);
const allocatedMonthToDate = monthToDateBuckets.reduce((sum, bucket) => sum + bucket.planned, 0);
if (Math.round(allocatedMonthToDate * 100) !== Math.round(monthToDatePlanned * 100)) {
  throw new Error(`month-to-date allocation drift: ${allocatedMonthToDate} vs ${monthToDatePlanned}`);
}

// Remainders are allocated to cents instead of being dropped independently by buckets.
const oddWeekNow = new Date(2026, 8, 11, 12, 0, 0);
const oddWeekBuckets = buildPeriodBuckets([], 'week', 100, null, null, oddWeekNow);
const oddWeekSum = oddWeekBuckets.reduce((sum, bucket) => sum + bucket.planned, 0);
if (Math.round(oddWeekSum * 100) !== 10000) throw new Error(`week remainder lost: ${oddWeekSum}`);

// Leap-year elapsed plan uses calendar days (Jan + Feb = 60/366), not timezone milliseconds.
const leapNow = new Date(2028, 1, 29, 12, 0, 0);
const leapShare = plannedShareForPeriod(366000, 'year', '2028-01-01', '2028-12-31', leapNow);
if (leapShare !== 60000) throw new Error(`leap-year share: ${leapShare}`);
const leapBuckets = buildPeriodBuckets([], 'year', 366000, '2028-01-01', '2028-12-31', leapNow);
if (leapBuckets.length !== 2) throw new Error(`year-to-date should expose two months, got ${leapBuckets.length}`);
if (Math.round(leapBuckets.reduce((sum, bucket) => sum + bucket.planned, 0) * 100) !== 6000000) {
  throw new Error('leap-year buckets do not conserve elapsed plan');
}

console.log('aggregateBudgetByPeriod.test OK');
