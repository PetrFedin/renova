/**
 * Агрегация бюджета по периодам.
 *
 * Truth convention:
 * - week/month/year are AS-OF periods ending on `now`, never future calendar time;
 * - when no phased plan exists, project plan is estimated uniformly by calendar day;
 * - money is allocated in kopecks with an exact remainder, so bucket plan always
 *   reconciles to the selected period plan.
 */
import type { BudgetPeriod } from '@/constants/budgetPeriod';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export type BudgetPeriodBucket = {
  key: string;
  label: string;
  spent: number;
  planned: number;
  /** true when planned is a presentation estimate, not a phased schedule fact */
  plannedIsEstimate: boolean;
  rows: ExpenseDetailRow[];
};

const DAY_MS = 86_400_000;

function atDayStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function atDayEnd(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/** Parse YYYY-MM-DD as a local calendar date, not UTC midnight. */
export function parseLocalDateOnly(value?: string | null, endOfDay = false): Date | null {
  const raw = (value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return endOfDay ? atDayEnd(date) : atDayStart(date);
}

function calendarOrdinal(d: Date): number {
  // Convert LOCAL calendar components to a timezone-neutral ordinal. This keeps
  // day counts stable across DST and across UTC/Moscow/Toronto runtimes.
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

function inclusiveCalendarDays(start: Date, end: Date): number {
  return Math.max(0, calendarOrdinal(end) - calendarOrdinal(start) + 1);
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function periodRange(period: BudgetPeriod, now = new Date()): { start: Date; end: Date; label: string } {
  const end = atDayEnd(now);
  if (period === 'week') {
    const start = atDayStart(now);
    start.setDate(start.getDate() - 6);
    return { start, end, label: 'Последние 7 дней' };
  }
  if (period === 'month') {
    const start = atDayStart(new Date(now.getFullYear(), now.getMonth(), 1));
    return { start, end, label: 'Текущий месяц по сегодня' };
  }
  if (period === 'year') {
    const start = atDayStart(new Date(now.getFullYear(), 0, 1));
    return { start, end, label: `${now.getFullYear()} год по сегодня` };
  }
  return { start: new Date(0), end, label: 'За весь проект' };
}

export function plannedShareForPeriod(
  plannedTotal: number,
  period: BudgetPeriod,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): number {
  if (!Number.isFinite(plannedTotal) || plannedTotal <= 0) return 0;
  if (period === 'all') return roundMoney(plannedTotal);

  const { start, end } = periodRange(period, now);
  const pStart = parseLocalDateOnly(projectStart) ?? start;
  const pEnd = parseLocalDateOnly(projectEnd, true) ?? end;
  if (pEnd < pStart) return 0;

  const projectDays = inclusiveCalendarDays(pStart, pEnd);
  if (!projectDays) return 0;

  const overlapStart = pStart > start ? pStart : start;
  const overlapEnd = pEnd < end ? pEnd : end;
  const overlapDays = inclusiveCalendarDays(overlapStart, overlapEnd);
  if (!overlapDays) return 0;

  return roundMoney(plannedTotal * (overlapDays / projectDays));
}

function rowInRange(row: ExpenseDetailRow, start: Date, end: Date) {
  const d = parseLocalDateOnly(row.date);
  if (!d) return false;
  return d >= atDayStart(start) && d <= atDayEnd(end);
}

export function filterRowsByPeriod(
  rows: ExpenseDetailRow[],
  period: BudgetPeriod,
  now = new Date(),
): ExpenseDetailRow[] {
  if (period === 'all') return rows;
  const { start, end } = periodRange(period, now);
  return rows.filter((r) => rowInRange(r, start, end));
}

export function sumRows(rows: ExpenseDetailRow[]): number {
  return roundMoney(rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0));
}

function fmtDay(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

type BucketInterval = { start: Date; end: Date; key: string; label: string };

function buildIntervals(period: BudgetPeriod, now: Date): BucketInterval[] {
  const range = periodRange(period, now);

  if (period === 'week') {
    return Array.from({ length: 7 }, (_, index) => {
      const start = atDayStart(range.start);
      start.setDate(start.getDate() + index);
      const end = atDayEnd(start);
      return { start, end, key: localDateKey(start), label: fmtDay(start) };
    });
  }

  if (period === 'month') {
    const out: BucketInterval[] = [];
    let cursor = atDayStart(range.start);
    while (cursor <= range.end) {
      const start = atDayStart(cursor);
      const end = atDayEnd(start);
      end.setDate(end.getDate() + 6);
      if (end > range.end) end.setTime(range.end.getTime());
      out.push({
        start,
        end,
        key: localDateKey(start),
        label: `${fmtDay(start)} – ${fmtDay(end)}`,
      });
      cursor = atDayStart(end);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  if (period === 'year') {
    const out: BucketInterval[] = [];
    for (let month = 0; month <= range.end.getMonth(); month += 1) {
      const start = atDayStart(new Date(range.end.getFullYear(), month, 1));
      const naturalEnd = atDayEnd(new Date(range.end.getFullYear(), month + 1, 0));
      const end = naturalEnd > range.end ? atDayEnd(range.end) : naturalEnd;
      out.push({
        start,
        end,
        key: `${range.end.getFullYear()}-${String(month + 1).padStart(2, '0')}`,
        label: fmtMonth(start),
      });
    }
    return out;
  }

  return [{ start: range.start, end: range.end, key: 'all', label: 'Весь проект' }];
}

/**
 * Allocate money proportionally to weights in integer kopecks. The final sum
 * therefore reconciles exactly to roundMoney(total), including odd remainders.
 */
export function allocateMoneyExactly(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const totalMinor = Math.max(0, Math.round(roundMoney(total) * 100));
  if (!totalWeight || !totalMinor) return weights.map(() => 0);

  const raw = safeWeights.map((weight) => (totalMinor * weight) / totalWeight);
  const allocated = raw.map((value) => Math.floor(value));
  let remainder = totalMinor - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    allocated[order[i % order.length].index] += 1;
  }
  return allocated.map((minor) => minor / 100);
}

/** Подробные интервалы внутри выбранного AS-OF периода. */
export function buildPeriodBuckets(
  rows: ExpenseDetailRow[],
  period: BudgetPeriod,
  plannedTotal: number,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): BudgetPeriodBucket[] {
  const periodPlanned = plannedShareForPeriod(plannedTotal, period, projectStart, projectEnd, now);
  const filtered = filterRowsByPeriod(rows, period, now);

  if (period === 'all') {
    return [
      {
        key: 'all',
        label: 'Весь проект',
        spent: sumRows(filtered),
        planned: roundMoney(plannedTotal),
        plannedIsEstimate: false,
        rows: filtered,
      },
    ];
  }

  const intervals = buildIntervals(period, now);
  const weights = intervals.map((interval) => inclusiveCalendarDays(interval.start, interval.end));
  const allocation = allocateMoneyExactly(periodPlanned, weights);

  return intervals.map((interval, index) => {
    const intervalRows = filtered.filter((row) => rowInRange(row, interval.start, interval.end));
    return {
      key: interval.key,
      label: interval.label,
      spent: sumRows(intervalRows),
      planned: allocation[index],
      plannedIsEstimate: true,
      rows: intervalRows,
    };
  });
}
