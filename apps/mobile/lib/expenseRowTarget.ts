/** Разбор строки ExpenseDetailTable → сущность для detail sheet */
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import type { MaterialPick, OsExpense, ReceiptItem } from '@/lib/api';

export type ExpenseRowTarget =
  | ExpenseDetailTarget
  | { kind: 'material'; pick: MaterialPick };

export function resolveExpenseRowTarget(
  row: ExpenseDetailRow,
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
): ExpenseRowTarget | null {
  if (row.kind === 'receipt') {
    const id = row.id.replace(/^rc-/, '');
    const item = receipts.find((r) => r.id === id);
    return item ? { kind: 'receipt', item } : null;
  }
  if (row.kind === 'expense') {
    const id = row.id.replace(/^ex-/, '');
    const item = expenses.find((e) => e.id === id);
    return item ? { kind: 'expense', item } : null;
  }
  if (row.kind === 'material') {
    const id = row.id.replace(/^mp-/, '');
    const pick = picks.find((p) => p.id === id);
    return pick ? { kind: 'material', pick } : null;
  }
  return null;
}
