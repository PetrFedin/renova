import { filterRowsByPeriod, sumRows, plannedShareForPeriod, allocateEven, buildPeriodBuckets } from './aggregateBudgetByPeriod';
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

// Fixed `now` so this assertion doesn't depend on the wall-clock date the suite
// happens to run on (plannedShareForPeriod previously had no way to pin "now",
// so this test silently broke outside the June-August 2026 project window).
const share = plannedShareForPeriod(120000, 'month', '2026-06-01', '2026-08-31', now);
if (!(share > 0 && share < 120000)) throw new Error('planned share');

// issue #318 regression: buildPeriodBuckets('month') created 5 weekly buckets for
// most months but divided periodPlanned by a hardcoded 4, so periodPlanned=100000
// summed to 125000 (125% of plan) across the buckets. allocateEven must distribute
// the ACTUAL bucket count with the remainder assigned exactly once, never lost or
// duplicated, for every day-count a month can have (28/29/30/31).
for (const n of [4, 5, 6, 7, 12, 28, 29, 30, 31]) {
  for (const total of [100000, 100000.01, 33.33, 0, 1, 99999.99]) {
    const shares = allocateEven(total, n);
    if (shares.length !== n) throw new Error(`allocateEven length for n=${n}`);
    const sum = Math.round(shares.reduce((s, v) => s + v, 0) * 100) / 100;
    const expected = Math.round(total * 100) / 100;
    if (sum !== expected) {
      throw new Error(`allocateEven(${total}, ${n}) summed to ${sum}, expected exactly ${expected} (issue #318)`);
    }
  }
}

// Exact audit counterexample: 100000 plan split across 5 buckets must sum to
// 100000, not 125000 (the old Math.round(100000/4)*5 result).
const fiveBucketShares = allocateEven(100000, 5);
const fiveBucketSum = fiveBucketShares.reduce((s, v) => s + v, 0);
if (fiveBucketSum !== 100000) throw new Error(`5-bucket month must sum to plan exactly, got ${fiveBucketSum} (regression: old code produced 125000)`);

// buildPeriodBuckets('month') on the live calendar month must also sum to the
// exact period-planned amount, whatever the current month's bucket count is.
const monthBuckets = buildPeriodBuckets([], 'month', 100000);
const monthPlanSum = Math.round(monthBuckets.reduce((s, b) => s + b.planned, 0) * 100) / 100;
if (monthPlanSum !== 100000) throw new Error(`buildPeriodBuckets month sum was ${monthPlanSum}, expected 100000`);

console.log('aggregateBudgetByPeriod.test OK');
