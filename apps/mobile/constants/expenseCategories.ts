/** Категории расходов по чекам — id для форм, подписи в constants/labels */
export const EXPENSE_CATEGORIES = [
  { id: 'materials', label: 'Материалы' },
  { id: 'labor', label: 'Работы / бригада' },
  { id: 'delivery', label: 'Доставка' },
  { id: 'tools', label: 'Инструмент' },
  { id: 'other', label: 'Прочее' },
] as const;

export type ExpenseCategoryId = (typeof EXPENSE_CATEGORIES)[number]['id'];

export { expenseCategoryLabel } from '@/constants/labels';
