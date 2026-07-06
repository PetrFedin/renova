/** Навигация по строке unified expenses — отдельно от resolve (без expo-router в тестах) */
import { router } from 'expo-router';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import type { MaterialPick, OsExpense, ReceiptItem } from '@/lib/api';
import { resolveExpenseRowTarget } from '@/lib/expenseRowTarget';

export function openExpenseRowTarget(
  row: ExpenseDetailRow,
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  options: { returnTo: string; onDetail: (target: ExpenseDetailTarget) => void },
): boolean {
  const target = resolveExpenseRowTarget(row, receipts, expenses, picks);
  if (!target) return false;
  if (target.kind === 'material') {
    router.push({ pathname: '/material/[id]', params: { id: target.pick.id, returnTo: options.returnTo } } as any);
    return true;
  }
  options.onDetail(target);
  return true;
}
