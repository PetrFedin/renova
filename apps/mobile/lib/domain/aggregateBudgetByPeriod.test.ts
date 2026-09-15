import {
  allocateMoneyExactly,
  buildPeriodBuckets,
  filterRowsByPeriod,
  parseLocalDateOnly,
  plannedShareForPeriod,
  sumRows,
} from './aggregateBudgetByPeriod';
import type { ExpenseDetailRow } from './expenseAnalytics';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function sumPlanCents(rows: { planned: number }[]): number {
  return rows.reduce((sum, row) => sum + cents(row.planned), 0);
}

function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function row(id: string, date: string, amount = 1): ExpenseDetailRow {
  return {
    id,
    date,
    title: id,
    amount,
    category: 'materials',
    categoryLabel: 'Материалы',
    kind: 'expense',
    hasDocument: false,
  };
}

// Exact kopeck remainder: presentation must never create or lose plan.
const split = allocateMoneyExactly(100000.01, [7, 7, 7, 7, 3]);
assert(sumPlanCents(split.map((planned) => ({ planned }))) === cents(100000.01), 'exact kopeck allocation');

// 28/29/30/31-day months including leap February and non-divisible amount.
for (const sample of [
  { year: 2026, month: 2, last: 28 },
  { year: 2024, month: 2, last: 29 },
  { year: 2026, month: 4, last: 30 },
  { year: 2026, month: 3, last: 31 },
]) {
  const start = `${sample.year}-${String(sample.month).padStart(2, '0')}-01`;
  const end = `${sample.year}-${String(sample.month).padStart(2, '0')}-${sample.last}`;
  const now = localNoon(sample.year, sample.month, sample.last);
  const buckets = buildPeriodBuckets([], 'month', 100000.01, start, end, now);
  assert(
    sumPlanCents(buckets) === cents(100000.01),
    `${sample.last}-day month must reconcile exactly`,
  );
  assert(buckets.every((bucket) => bucket.plannedIsEstimate), 'month plan must be labelled estimate');
  assert(buckets.length === Math.ceil(sample.last / 7), `${sample.last}-day month bucket count`);
}

// Current month is AS-OF today: no future weeks or future transactions.
const partialNow = localNoon(2026, 9, 16);
const partialPlan = plannedShareForPeriod(
  30000,
  'month',
  '2026-09-01',
  '2026-09-30',
  partialNow,
);
assert(cents(partialPlan) === cents(16000), 'partial month must allocate only 16/30 calendar days');
const partialRows = [
  row('past', '2026-09-03', 100),
  row('today', '2026-09-16', 200),
  row('future', '2026-09-17', 999),
  row('invalid', 'not-a-date', 999),
];
const filteredPartial = filterRowsByPeriod(partialRows, 'month', partialNow);
assert(sumRows(filteredPartial) === 300, 'future/invalid expense dates excluded');
const partialBuckets = buildPeriodBuckets(
  partialRows,
  'month',
  30000,
  '2026-09-01',
  '2026-09-30',
  partialNow,
);
assert(partialBuckets.length === 3, 'Sep 1-16 should have three as-of weekly buckets');
assert(sumPlanCents(partialBuckets) === cents(partialPlan), 'partial month buckets reconcile period plan');
assert(partialBuckets.reduce((sum, bucket) => sum + bucket.spent, 0) === 300, 'bucket fact uses same as-of boundary');

// Leap-year YTD: Jan + Feb only, 60/366 of annual plan, exact bucket reconciliation.
const leapNow = localNoon(2024, 2, 29);
const leapPlan = plannedShareForPeriod(36600, 'year', '2024-01-01', '2024-12-31', leapNow);
assert(cents(leapPlan) === cents(6000), 'leap-year YTD plan must use 60/366 calendar days');
const leapBuckets = buildPeriodBuckets([], 'year', 36600, '2024-01-01', '2024-12-31', leapNow);
assert(leapBuckets.length === 2, 'YTD should not include future months');
assert(sumPlanCents(leapBuckets) === cents(leapPlan), 'YTD buckets reconcile exactly');

// Date-only strings use local calendar components instead of UTC midnight.
const localDate = parseLocalDateOnly('2026-09-16');
assert(localDate !== null, 'valid date-only parse');
assert(localDate.getFullYear() === 2026 && localDate.getMonth() === 8 && localDate.getDate() === 16, 'local date stable');
assert(parseLocalDateOnly('2026-02-30') === null, 'invalid calendar date rejected');
assert(parseLocalDateOnly('') === null, 'empty date rejected');

console.log('aggregateBudgetByPeriod.test OK');
