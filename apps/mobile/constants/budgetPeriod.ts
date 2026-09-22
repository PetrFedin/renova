/** Периоды drill-down бюджета */
export type BudgetPeriod = 'week' | 'month' | 'year' | 'all';
export type BudgetFocus = 'plan' | 'fact' | 'forecast' | 'left';

export const BUDGET_PERIOD_LABEL: Record<BudgetPeriod, string> = {
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
  all: 'Всё',
};

/**
 * За какой срок считается план периода. Факт берётся с начала периода по
 * сегодня, а план — на весь календарный месяц или год, поэтому подпись должна
 * называть именно этот срок и не выдавать план месяца за «долю за период».
 */
export const BUDGET_PLAN_SPAN_LABEL: Record<BudgetPeriod, string> = {
  week: 'последние 7 дней',
  month: 'текущий месяц',
  year: 'текущий год',
  all: 'весь проект',
};

export const BUDGET_FOCUS_LABEL: Record<BudgetFocus, string> = {
  plan: 'План',
  fact: 'Факт',
  forecast: 'Прогноз',
  left: 'Остаток',
};

export function parseBudgetPeriod(v?: string | string[]): BudgetPeriod {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === 'week' || s === 'month' || s === 'year' || s === 'all') return s;
  return 'month';
}

export function parseBudgetFocus(v?: string | string[]): BudgetFocus | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === 'plan' || s === 'fact' || s === 'forecast' || s === 'left') return s;
  return null;
}
