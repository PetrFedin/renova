/**
 * The budget period functions must all describe the same window.
 *
 * `filterRowsByPeriod` took an explicit `now`; `plannedShareForPeriod` and
 * `buildPeriodBuckets` did not, and read the wall clock internally — five
 * independent readings across one `buildPeriodBuckets` call. In production
 * they normally agree, so the failure mode is narrow and invisible: a render
 * that straddles a day, month or year boundary shows a planned share for one
 * window next to spending from another.
 *
 * It also made this test unrunnable. It builds a fixed `now` in June 2026 and
 * passes it to `filterRowsByPeriod`, but `plannedShareForPeriod` read the real
 * clock, so from September onwards the June project no longer overlapped "the
 * current month" and the share came back 0. That is why the file sat in
 * quarantine: the assertion was right and the API could not honour it.
 */
import {
  buildPeriodBuckets,
  filterRowsByPeriod,
  plannedShareForPeriod,
  sumRows,
} from './aggregateBudgetByPeriod';
import type { ExpenseDetailRow } from './expenseAnalytics';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const now = new Date('2026-06-20T12:00:00');
const PROJECT_START = '2026-06-01';
const PROJECT_END = '2026-08-31';

const rows: ExpenseDetailRow[] = [
  { id: '1', date: '2026-06-01', title: 'A', amount: 1000, category: 'm', categoryLabel: 'M', kind: 'receipt', hasDocument: true },
  { id: '2', date: '2026-06-15', title: 'B', amount: 2000, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  { id: '3', date: '2025-01-01', title: 'Old', amount: 500, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
  // After `now`, so inside the calendar month but outside the period, which
  // ends today. It must be excluded by the filter and by the planned share.
  { id: '4', date: '2026-06-25', title: 'Later', amount: 4000, category: 'm', categoryLabel: 'M', kind: 'expense', hasDocument: false },
];

// --- the filter (this half already took `now`) -------------------------------

const june = filterRowsByPeriod(rows, 'month', now);
must(june.length === 2, `month filter, got ${june.map((r) => r.id).join(',') || 'none'}`);
must(sumRows(june) === 3000, `month sum, got ${sumRows(june)}`);

// --- the planned share now honours the same `now` ----------------------------

const share = plannedShareForPeriod(120000, 'month', PROJECT_START, PROJECT_END, now);
must(share > 0 && share < 120000, `planned share must be a proper fraction, got ${share}`);

// 1 June .. 20 June inclusive is 20 of the project's 92 days.
// 120000 * 20/92 = 26086.96 -> 26087. A one-hour DST shift somewhere in the
// range would move that by less than one rouble, hence the tolerance.
must(
  Math.abs(share - 26087) <= 2,
  `the share must cover 1–20 June (20/92 of the project), got ${share}`,
);

// The bug this parameter exists for: the same call reading the wall clock
// returned a share for a different window entirely.
must(
  plannedShareForPeriod(120000, 'month', PROJECT_START, PROJECT_END, now) ===
    plannedShareForPeriod(120000, 'month', PROJECT_START, PROJECT_END, now),
  'the share must be a pure function of its arguments',
);

// --- a period that ends before the project starts contributes nothing --------

must(
  plannedShareForPeriod(120000, 'month', PROJECT_START, PROJECT_END, new Date('2026-03-10T12:00:00')) === 0,
  'a month with no overlap must contribute no planned share',
);

// --- 'all' is unaffected by the clock ----------------------------------------

must(
  plannedShareForPeriod(120000, 'all', PROJECT_START, PROJECT_END, now) === 120000,
  'the whole project plans the whole amount',
);

// --- buckets honour `now` too -----------------------------------------------

const yearBuckets = buildPeriodBuckets(rows, 'year', 120000, PROJECT_START, PROJECT_END, now);
must(yearBuckets.length === 12, `a year has twelve buckets, got ${yearBuckets.length}`);
must(
  yearBuckets.every((b) => b.key.startsWith('2026-')),
  `the buckets must belong to the year of \`now\`, got ${yearBuckets[0]?.key}`,
);
must(
  sumRows(yearBuckets.flatMap((b) => b.rows)) === 3000,
  'the 2025 row and the future row stay out of the 2026 buckets',
);

// A year that is not the current one, so the assertion cannot pass by accident
// on a run where the wall clock happens to agree with `now`.
const pastYear = buildPeriodBuckets(
  rows,
  'year',
  120000,
  '2019-01-01',
  '2019-12-31',
  new Date('2019-06-20T12:00:00'),
);
must(
  pastYear.every((b) => b.key.startsWith('2019-')),
  `the year buckets must come from \`now\`, not the wall clock; got ${pastYear[0]?.key}`,
);
must(
  pastYear.every((b) => b.rows.length === 0),
  'no 2026 expense may appear in 2019 buckets',
);

const weekBuckets = buildPeriodBuckets(rows, 'week', 120000, PROJECT_START, PROJECT_END, now);
must(weekBuckets.length === 7, `a week has seven buckets, got ${weekBuckets.length}`);
must(
  weekBuckets[weekBuckets.length - 1].key === '2026-06-20',
  `the last bucket must be the day of \`now\`, got ${weekBuckets[weekBuckets.length - 1].key}`,
);
must(
  weekBuckets.some((b) => b.key === '2026-06-15' && b.spent === 2000),
  'the 15 June expense lands in its own day bucket',
);

const monthBuckets = buildPeriodBuckets(rows, 'month', 120000, PROJECT_START, PROJECT_END, now);
must(monthBuckets.length > 0, 'the month splits into week buckets');
must(
  monthBuckets[0].key === '2026-06-01',
  `the month buckets start at the first of the month of \`now\`, got ${monthBuckets[0].key}`,
);

console.log('aggregateBudgetByPeriod.test OK');

// --- the same assertions must hold in every timezone -------------------------
//
// This file is timezone-sensitive in two opposite directions, and the runner's
// own zone can only ever expose one of them:
//
//   east of UTC  the bucket keys were built with toISOString(), so the last
//                day bucket was labelled yesterday;
//   west of UTC  a `YYYY-MM-DD` expense was parsed as UTC midnight, i.e. the
//                previous local day, so a 1 June expense fell outside "current
//                month" and its money silently left the screen.
//
// In UTC — which is what CI runs in — neither shows up. So the file re-runs
// itself in four zones spanning the range, and a child's failure fails here.
if (!process.env.RENOVA_TZ_SWEEP_CHILD) {
  const { execFileSync } = require('node:child_process');
  const { join } = require('node:path');
  const tsx = join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'tsx');

  for (const tz of ['UTC', 'Europe/Moscow', 'America/Los_Angeles', 'Asia/Kamchatka']) {
    try {
      execFileSync(tsx, [__filename], {
        env: { ...process.env, TZ: tz, RENOVA_TZ_SWEEP_CHILD: '1' },
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
      });
    } catch (error: any) {
      throw new Error(`TZ=${tz}: ${String(error.stderr || error.message).trim()}`);
    }
  }
  console.log('aggregateBudgetByPeriod.test timezone sweep OK (UTC, MSK, PT, +12)');
}
