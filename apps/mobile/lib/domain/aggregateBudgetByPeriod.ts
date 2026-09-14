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

export function plannedShareForPeriod(
  plannedTotal: number,
  period: BudgetPeriod,
  projectStart?: string | null,
  projectEnd?: string | null,
): number {
  if (plannedTotal <= 0) return 0;
  if (period === 'all') return plannedTotal;
  const { start, end } = periodRange(period);
  const pStart = projectStart ? atDayStart(new Date(projectStart.slice(0, 10))) : start;
  const pEnd = projectEnd ? atDayEnd(new Date(projectEnd.slice(0, 10))) : end;
  const projMs = Math.max(1, pEnd.getTime() - pStart.getTime());
  const overlapStart = Math.max(start.getTime(), pStart.getTime());
  const overlapEnd = Math.min(end.getTime(), pEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.round(plannedTotal * ((overlapEnd - overlapStart) / projMs));
}

function rowInRange(row: ExpenseDetailRow, start: Date, end: Date) {
  if (!row.date) return false;
  const d = atDayStart(new Date(row.date.slice(0, 10)));
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

/** Подробные интервалы внутри выбранного периода */
/**
 * #318 / mandate B0-5: split `total` across `count` buckets so that the parts
 * sum EXACTLY to `total` (largest-remainder allocation on integer rubles).
 * Independent rounding (`round(total/4)` × 5 buckets) previously overstated a
 * 31-day month plan by up to 25 %.
 */
export function allocateEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Number.isFinite(total) ? Math.round(total) : 0;
  const base = Math.trunc(safeTotal / count);
  let remainder = safeTotal - base * count;
  const step = remainder >= 0 ? 1 : -1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let v = base;
    if (remainder !== 0) {
      v += step;
      remainder -= step;
    }
    out.push(v);
  }
  return out;
}

export function buildPeriodBuckets(
  rows: ExpenseDetailRow[],
  period: BudgetPeriod,
  plannedTotal: number,
  projectStart?: string | null,
  projectEnd?: string | null,
): BudgetPeriodBucket[] {
  const periodPlanned = plannedShareForPeriod(plannedTotal, period, projectStart, projectEnd);
  const filtered = filterRowsByPeriod(rows, period);

  if (period === 'week') {
    const { start } = periodRange(period);
    const buckets: BudgetPeriodBucket[] = [];
    for (let i = 0; i < 7; i++) {
      const day = atDayStart(new Date(start));
      day.setDate(day.getDate() + i);
      const dayEnd = atDayEnd(day);
      const dayRows = filtered.filter((r) => rowInRange(r, day, dayEnd));
      buckets.push({
        key: day.toISOString().slice(0, 10),
        label: fmtDay(day),
        spent: sumRows(dayRows),
        planned: 0,
        rows: dayRows,
      });
    }
    return assignPlanned(buckets, periodPlanned);
  }

  if (period === 'month') {
    const now = new Date();
    const monthStart = atDayStart(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = atDayEnd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const buckets: BudgetPeriodBucket[] = [];
    let cursor = new Date(monthStart);
    while (cursor <= monthEnd) {
      const wStart = atDayStart(cursor);
      const wEnd = atDayEnd(new Date(cursor));
      wEnd.setDate(wEnd.getDate() + 6);
      if (wEnd > monthEnd) wEnd.setTime(monthEnd.getTime());
      const wRows = filtered.filter((r) => rowInRange(r, wStart, wEnd));
      buckets.push({
        key: wStart.toISOString().slice(0, 10),
        label: `${fmtDay(wStart)} – ${fmtDay(wEnd)}`,
        spent: sumRows(wRows),
        planned: 0,
        rows: wRows,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return assignPlanned(buckets, periodPlanned);
  }

  if (period === 'year') {
    const y = new Date().getFullYear();
    const yearBuckets = Array.from({ length: 12 }, (_, m) => {
      const mStart = atDayStart(new Date(y, m, 1));
      const mEnd = atDayEnd(new Date(y, m + 1, 0));
      const mRows = filtered.filter((r) => rowInRange(r, mStart, mEnd));
      return {
        key: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: fmtMonth(mStart),
        spent: sumRows(mRows),
        planned: 0,
        rows: mRows,
      };
    });
    return assignPlanned(yearBuckets, periodPlanned);
  }

  return [
    {
      key: 'all',
      label: 'Весь проект',
      spent: sumRows(filtered),
      planned: plannedTotal,
      rows: filtered,
    },
  ];
}

function assignPlanned(buckets: BudgetPeriodBucket[], periodPlanned: number): BudgetPeriodBucket[] {
  const parts = allocateEvenly(periodPlanned, buckets.length);
  return buckets.map((b, i) => ({ ...b, planned: parts[i] ?? 0 }));
}
