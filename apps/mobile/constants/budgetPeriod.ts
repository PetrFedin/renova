/** Периоды drill-down бюджета */
export type BudgetPeriod = 'week' | 'month' | 'year' | 'all';
export type BudgetFocus = 'plan' | 'fact' | 'forecast' | 'left';

export const BUDGET_PERIOD_LABEL: Record<BudgetPeriod, string> = {
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
  all: 'Всё',
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
