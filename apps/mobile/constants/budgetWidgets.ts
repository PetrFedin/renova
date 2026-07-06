/** Виджеты вкладки «Бюджет → Сводка» — настраиваются в профиле */
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
  { id: 'repair_control', label: 'Контроль бюджета', hint: 'Смета · чеки · оплаты' },
  { id: 'budget_alerts', label: 'Превышение по комнатам' },
  { id: 'actions', label: 'Кнопки действий', hint: 'Таблица · документы · оценка' },
  { id: 'segments', label: 'По статьям' },
  { id: 'pending_payments', label: 'Ожидает оплаты' },
  { id: 'expense_preview', label: 'Последние расходы' },
];

export const BUDGET_WIDGET_DEFAULT: BudgetWidgetId[] = BUDGET_WIDGET_CATALOG.map((w) => w.id);

export type BudgetWidgetRole = OsRole;
