/** Агрегация бюджета по периодам — неделя, месяц, год */
import type { BudgetPeriod } from '@/constants/budgetPeriod';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export type BudgetPeriodBucket = {
  key: string;
  label: string;
  spent: number;
  planned: number;
  rows: ExpenseDetailRow[];
};

type BucketRange = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

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

function parseLocalIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) return null;
  return parsed;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calendarDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

function overlapCalendarDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(calendarDayNumber(aStart), calendarDayNumber(bStart));
  const end = Math.min(calendarDayNumber(aEnd), calendarDayNumber(bEnd));
  return Math.max(0, end - start + 1);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function distributeMoney(total: number, weights: number[]): number[] {
  const totalCents = Math.max(0, Math.round(roundMoney(total) * 100));
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalCents === 0 || totalWeight <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => totalCents * Math.max(0, weight) / totalWeight);
  const cents = exact.map((value) => Math.floor(value));
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    cents[order[i].index] += 1;
    remainder -= 1;
  }
  return cents.map((value) => value / 100);
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
    return { start, end, label: 'Текущий месяц' };
  }
  if (period === 'year') {
    const start = atDayStart(new Date(now.getFullYear(), 0, 1));
    return { start, end, label: `${now.getFullYear()} год` };
  }
  return { start: new Date(0), end, label: 'За весь проект' };
}

function projectRange(
  periodStart: Date,
  periodEnd: Date,
  projectStart?: string | null,
  projectEnd?: string | null,
): { start: Date; end: Date } {
  const parsedStart = projectStart ? parseLocalIsoDate(projectStart) : null;
  const parsedEnd = projectEnd ? parseLocalIsoDate(projectEnd) : null;
  return {
    start: parsedStart ? atDayStart(parsedStart) : periodStart,
    end: parsedEnd ? atDayEnd(parsedEnd) : periodEnd,
  };
}

export function plannedShareForPeriod(
  plannedTotal: number,
  period: BudgetPeriod,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): number {
  if (plannedTotal <= 0) return 0;
  if (period === 'all') return roundMoney(plannedTotal);
  const { start, end } = periodRange(period, now);
  const project = projectRange(start, end, projectStart, projectEnd);
  const projectDays = Math.max(1, overlapCalendarDays(project.start, project.end, project.start, project.end));
  const overlapDays = overlapCalendarDays(start, end, project.start, project.end);
  if (overlapDays <= 0) return 0;
  return roundMoney(plannedTotal * (overlapDays / projectDays));
}

function rowInRange(row: ExpenseDetailRow, start: Date, end: Date) {
  if (!row.date) return false;
  const parsed = parseLocalIsoDate(row.date);
  if (!parsed) return false;
  const d = atDayStart(parsed);
  return d >= start && d <= end;
}

export function filterRowsByPeriod(rows: ExpenseDetailRow[], period: BudgetPeriod, now = new Date()): ExpenseDetailRow[] {
  if (period === 'all') return rows;
  const { start, end } = periodRange(period, now);
  return rows.filter((r) => rowInRange(r, start, end));
}

export function sumRows(rows: ExpenseDetailRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

function fmtDay(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function bucketRanges(period: BudgetPeriod, now: Date): BucketRange[] {
  const range = periodRange(period, now);

  if (period === 'week') {
    return Array.from({ length: 7 }, (_, index) => {
      const start = atDayStart(range.start);
      start.setDate(start.getDate() + index);
      const end = atDayEnd(start);
      return { key: dateKey(start), label: fmtDay(start), start, end };
    });
  }

  if (period === 'month') {
    const buckets: BucketRange[] = [];
    let cursor = atDayStart(range.start);
    while (cursor <= range.end) {
      const start = atDayStart(cursor);
      const end = atDayEnd(cursor);
      end.setDate(end.getDate() + 6);
      if (end > range.end) end.setTime(range.end.getTime());
      buckets.push({
        key: dateKey(start),
        label: `${fmtDay(start)} – ${fmtDay(end)}`,
        start,
        end,
      });
      cursor = atDayStart(end);
      cursor.setDate(cursor.getDate() + 1);
    }
    return buckets;
  }

  if (period === 'year') {
    const buckets: BucketRange[] = [];
    for (let month = 0; month <= now.getMonth(); month += 1) {
      const start = atDayStart(new Date(now.getFullYear(), month, 1));
      const naturalEnd = atDayEnd(new Date(now.getFullYear(), month + 1, 0));
      const end = naturalEnd > range.end ? new Date(range.end) : naturalEnd;
      buckets.push({
        key: `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}`,
        label: fmtMonth(start),
        start,
        end,
      });
    }
    return buckets;
  }

  return [{ key: 'all', label: 'Весь проект', start: range.start, end: range.end }];
}

/** Подробные интервалы внутри выбранного периода. План — линейная оценка, не фазовый cash-flow. */
export function buildPeriodBuckets(
  rows: ExpenseDetailRow[],
  period: BudgetPeriod,
  plannedTotal: number,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): BudgetPeriodBucket[] {
  const range = periodRange(period, now);
  const ranges = bucketRanges(period, now);
  const filtered = filterRowsByPeriod(rows, period, now);
  const periodPlanned = plannedShareForPeriod(plannedTotal, period, projectStart, projectEnd, now);

  if (period === 'all') {
    return [{
      key: 'all',
      label: 'Весь проект',
      spent: sumRows(filtered),
      planned: roundMoney(plannedTotal),
      rows: filtered,
    }];
  }

  const project = projectRange(range.start, range.end, projectStart, projectEnd);
  const weights = ranges.map((bucket) => overlapCalendarDays(bucket.start, bucket.end, project.start, project.end));
  const plannedByBucket = distributeMoney(periodPlanned, weights);

  return ranges.map((bucket, index) => {
    const bucketRows = filtered.filter((row) => rowInRange(row, bucket.start, bucket.end));
    return {
      key: bucket.key,
      label: bucket.label,
      spent: sumRows(bucketRows),
      planned: plannedByBucket[index],
      rows: bucketRows,
    };
  });
}
