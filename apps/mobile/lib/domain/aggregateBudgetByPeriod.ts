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

/**
 * Окно, за которое считается план периода.
 *
 * Оно намеренно шире окна фактов: факты берутся по `periodRange` — то есть
 * «с начала месяца по сегодня», а план месяца — это план на весь месяц.
 * Раньше обе величины считались по одному укороченному окну, и «план периода»
 * подрастал каждый день сам по себе, а интервалы в разделе «Распределение
 * плана» покрывали месяц целиком и с этим числом не сходились.
 */
export function periodPlanRange(period: BudgetPeriod, now = new Date()): { start: Date; end: Date } {
  if (period === 'month') {
    return {
      start: atDayStart(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: atDayEnd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  if (period === 'year') {
    return {
      start: atDayStart(new Date(now.getFullYear(), 0, 1)),
      end: atDayEnd(new Date(now.getFullYear(), 11, 31)),
    };
  }
  const { start, end } = periodRange(period, now);
  return { start, end };
}

/** Срок проекта, к которому привязан план. По умолчанию — само окно периода. */
function projectWindow(
  fallback: { start: Date; end: Date },
  projectStart?: string | null,
  projectEnd?: string | null,
): { start: Date; end: Date; ms: number } {
  const start = projectStart ? atDayStart(new Date(projectStart.slice(0, 10))) : fallback.start;
  const end = projectEnd ? atDayEnd(new Date(projectEnd.slice(0, 10))) : fallback.end;
  return { start, end, ms: Math.max(1, end.getTime() - start.getTime()) };
}

function overlapMs(a: { start: Date; end: Date }, b: { start: Date; end: Date }): number {
  const from = Math.max(a.start.getTime(), b.start.getTime());
  const to = Math.min(a.end.getTime(), b.end.getTime());
  return to > from ? to - from : 0;
}

/**
 * Разложить целую сумму по весам без потерь: целые части плюс остаток по
 * наибольшим дробным долям. Сумма результата в точности равна `total` —
 * именно это и не выполнялось, когда каждому интервалу месяца выдавалась
 * фиксированная четверть: в месяце из 30-31 дня интервалов пять, и план
 * в разделе складывался в 125% от плана периода.
 */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let rest = Math.round(total - out.reduce((s, x) => s + x, 0));
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && rest > 0; k += 1) {
    out[order[k].i] += 1;
    rest -= 1;
  }
  return out;
}

export function plannedShareForPeriod(
  plannedTotal: number,
  period: BudgetPeriod,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): number {
  if (plannedTotal <= 0) return 0;
  if (period === 'all') return plannedTotal;
  const range = periodPlanRange(period, now);
  const proj = projectWindow(range, projectStart, projectEnd);
  return Math.round(plannedTotal * (overlapMs(range, proj) / proj.ms));
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

type BucketRange = { key: string; label: string; start: Date; end: Date };

function bucketRanges(period: BudgetPeriod, now: Date): BucketRange[] {
  if (period === 'week') {
    const { start } = periodRange(period, now);
    return Array.from({ length: 7 }, (_, i) => {
      const day = atDayStart(new Date(start));
      day.setDate(day.getDate() + i);
      return { key: day.toISOString().slice(0, 10), label: fmtDay(day), start: day, end: atDayEnd(day) };
    });
  }

  if (period === 'month') {
    const { start: monthStart, end: monthEnd } = periodPlanRange('month', now);
    const out: BucketRange[] = [];
    const cursor = new Date(monthStart);
    while (cursor <= monthEnd) {
      const wStart = atDayStart(cursor);
      const wEnd = atDayEnd(new Date(cursor));
      wEnd.setDate(wEnd.getDate() + 6);
      if (wEnd > monthEnd) wEnd.setTime(monthEnd.getTime());
      out.push({
        key: wStart.toISOString().slice(0, 10),
        label: `${fmtDay(wStart)} – ${fmtDay(wEnd)}`,
        start: wStart,
        end: wEnd,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }

  if (period === 'year') {
    const y = now.getFullYear();
    return Array.from({ length: 12 }, (_, m) => {
      const mStart = atDayStart(new Date(y, m, 1));
      const mEnd = atDayEnd(new Date(y, m + 1, 0));
      return {
        key: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: fmtMonth(mStart),
        start: mStart,
        end: mEnd,
      };
    });
  }

  return [];
}

/**
 * Подробные интервалы внутри выбранного периода.
 *
 * План интервала — это доля плана проекта, приходящаяся на те дни интервала,
 * что попадают в срок проекта. Интервалы покрывают окно плана целиком, поэтому
 * сумма их планов в точности равна плану периода из `plannedShareForPeriod` —
 * это обеспечивает `apportion`, а не деление на фиксированное число частей.
 * Интервал вне срока проекта получает ноль: плана на эти дни действительно нет.
 */
export function buildPeriodBuckets(
  rows: ExpenseDetailRow[],
  period: BudgetPeriod,
  plannedTotal: number,
  projectStart?: string | null,
  projectEnd?: string | null,
  now = new Date(),
): BudgetPeriodBucket[] {
  const filtered = filterRowsByPeriod(rows, period, now);

  if (period === 'all') {
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

  const periodPlanned = plannedShareForPeriod(plannedTotal, period, projectStart, projectEnd, now);
  const ranges = bucketRanges(period, now);
  const proj = projectWindow(periodPlanRange(period, now), projectStart, projectEnd);
  const planned = apportion(periodPlanned, ranges.map((r) => overlapMs(r, proj)));

  return ranges.map((r, i) => {
    const bucketRows = filtered.filter((row) => rowInRange(row, r.start, r.end));
    return {
      key: r.key,
      label: r.label,
      spent: sumRows(bucketRows),
      planned: planned[i],
      rows: bucketRows,
    };
  });
}
