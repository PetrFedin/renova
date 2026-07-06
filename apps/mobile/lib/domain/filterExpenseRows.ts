/** Клиентские фильтры вкладки «Бюджет → Расходы» */
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export type ExpenseListFilter = 'all' | 'no-stage' | 'unverified';

export const EXPENSE_FILTER_LABELS: Record<ExpenseListFilter, string> = {
  all: 'Все',
  'no-stage': 'Без этапа',
  unverified: 'Не проверен',
};

export function filterExpenseRows(rows: ExpenseDetailRow[], filter: ExpenseListFilter): ExpenseDetailRow[] {
  if (filter === 'all') return rows;
  if (filter === 'no-stage') return rows.filter((row) => !row.stageId);
  if (filter === 'unverified') return rows.filter((row) => row.kind === 'receipt' && !row.verified);
  return rows;
}

export function expenseFilterCounts(rows: ExpenseDetailRow[]): Record<ExpenseListFilter, number> {
  return {
    all: rows.length,
    'no-stage': rows.filter((row) => !row.stageId).length,
    unverified: rows.filter((row) => row.kind === 'receipt' && !row.verified).length,
  };
}

/** ID чеков из строк списка расходов */
export function receiptIdsFromRows(rows: ExpenseDetailRow[]): string[] {
  return rows.filter((row) => row.kind === 'receipt').map((row) => row.id.replace(/^rc-/, ''));
}
