/** Единый список трат на вкладке «Бюджет → Расходы»: чеки + osExpenses + закупки материалов */
import type { MaterialPick, OsExpense, Purchase, ReceiptItem, Room, Stage } from '@/lib/api';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { buildExpenseDetailRows, type ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export function buildUnifiedBudgetExpenses(
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  rooms: Room[],
  stages: Stage[],
  picks: MaterialPick[] = [],
  purchases: Purchase[] = [],
): ExpenseDetailRow[] {
  return buildExpenseDetailRows(receipts, expenses, picks, rooms, stages, purchases)
    .filter((row) => row.kind === 'receipt' || row.kind === 'expense' || row.kind === 'material')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function rowToExpenseTarget(
  row: ExpenseDetailRow,
  receipts: ReceiptItem[],
  expenses: OsExpense[],
): ExpenseDetailTarget | null {
  if (row.kind === 'receipt') {
    const item = receipts.find((r) => r.id === row.id.replace(/^rc-/, ''));
    return item ? { kind: 'receipt', item } : null;
  }
  if (row.kind === 'expense') {
    const item = expenses.find((e) => e.id === row.id.replace(/^ex-/, ''));
    return item ? { kind: 'expense', item } : null;
  }
  return null;
}

export function unifiedExpenseTotal(rows: ExpenseDetailRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}
