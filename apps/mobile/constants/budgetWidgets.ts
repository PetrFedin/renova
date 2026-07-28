/** Виджеты вкладки «Бюджет → Сводка» — настраиваются в профиле.
 * Clarity F: default lean — KPI + оплаты + alerts + preview; контроль/сегменты — opt-in. */
import type { OsRole } from '@/constants/osSections';

export type BudgetWidgetId =
  | 'summary_kpi'
  | 'repair_control'
  | 'budget_alerts'
  | 'segments'
  | 'pending_payments'
  | 'expense_preview'
  | 'actions';

export type BudgetWidgetDef = {
  id: BudgetWidgetId;
  label: string;
  hint?: string;
};

export const BUDGET_WIDGET_CATALOG: BudgetWidgetDef[] = [
  { id: 'summary_kpi', label: 'Сводка 2×2', hint: 'План · факт · прогноз · остаток' },
  { id: 'pending_payments', label: 'Ожидает оплаты' },
  { id: 'budget_alerts', label: 'Превышение по комнатам' },
  { id: 'expense_preview', label: 'Последние расходы' },
  { id: 'repair_control', label: 'Контроль бюджета', hint: 'Смета · чеки · оплаты — подробный вид' },
  { id: 'segments', label: 'По статьям', hint: 'подробный вид' },
  { id: 'actions', label: 'Кнопки действий', hint: 'Таблица · оценка' },
];

/** Lean default: без repair_control / segments / actions */
export const BUDGET_WIDGET_DEFAULT: BudgetWidgetId[] = [
  'summary_kpi',
  'pending_payments',
  'budget_alerts',
  'expense_preview',
];

export type BudgetWidgetRole = OsRole;
