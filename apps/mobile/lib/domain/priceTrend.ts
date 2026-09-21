/**
 * Динамика рыночной цены: показать изменение, а не шесть одинаковых полос.
 *
 * Ширина полосы считалась как `Math.min(100, p.index)`, а `index` у сервера
 * колеблется в пределах 103–108. Значит **каждая** полоса упиралась в 100 % и
 * все шесть выходили одинаковой длины — при разнице значений около шести
 * процентов. Полоса не несла никакой информации, и что означают синие линии,
 * понять было нельзя.
 *
 * Подписи месяцев приходят с сервера латиницей («Apr 2026») — в русском
 * интерфейсе их собираем сами из `month` вида «2026-04».
 */

export type TrendPoint = { month: string; label: string; total: number; index: number };

const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** «2026-04» → «апр 2026». Непонятный формат оставляем как есть. */
export function trendMonthLabel(month: string, fallback = ''): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return fallback || month || '';
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return fallback || month;
  return `${MONTHS[index]} ${match[1]}`;
}

/**
 * Доля ширины полосы: 0 у самого дешёвого месяца, 1 у самого дорогого.
 *
 * Минимальная ширина оставлена намеренно — полоса нулевой длины читается как
 * «данных нет», а не как «здесь было дешевле всего».
 */
export const TREND_MIN_SHARE = 0.12;

export function trendBarShare(total: number, min: number, max: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(min) || !Number.isFinite(max)) return TREND_MIN_SHARE;
  if (max <= min) return 1;
  const share = (total - min) / (max - min);
  return TREND_MIN_SHARE + share * (1 - TREND_MIN_SHARE);
}

export type TrendSummary = {
  changePct: number;
  /** Куда ушла цена за весь период. */
  direction: 'up' | 'down' | 'flat';
  min: number;
  max: number;
};

/** Итог по периоду: насколько цена изменилась от первого месяца к последнему. */
export function trendSummary(points: TrendPoint[]): TrendSummary | null {
  const totals = points.map((p) => p.total).filter((t) => Number.isFinite(t));
  if (totals.length < 2) return null;
  const first = totals[0];
  const last = totals[totals.length - 1];
  if (!first) return null;
  const changePct = Math.round(((last - first) / first) * 1000) / 10;
  return {
    changePct,
    direction: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat',
    min: Math.min(...totals),
    max: Math.max(...totals),
  };
}

/** Строка под заголовком: что именно произошло с ценой. */
export function trendSummaryText(summary: TrendSummary | null): string {
  if (!summary) return '';
  if (summary.direction === 'flat') return 'Цена почти не менялась';
  const sign = summary.changePct > 0 ? '+' : '';
  const word = summary.direction === 'up' ? 'дороже' : 'дешевле';
  return `${sign}${summary.changePct} % за полгода — сейчас ${word}, чем в начале периода`;
}
