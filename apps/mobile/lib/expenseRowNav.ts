/** Навигация по строке unified expenses — отдельно от resolve (без expo-router в тестах) */
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import type { MaterialPick, OsExpense, ReceiptItem } from '@/lib/api';
import { resolveExpenseRowTarget } from '@/lib/expenseRowTarget';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';

export function openExpenseRowTarget(
  row: ExpenseDetailRow,
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  options: { returnTo: string; onDetail: (target: ExpenseDetailTarget) => void; role?: OsRole },
): boolean {
  const target = resolveExpenseRowTarget(row, receipts, expenses, picks);
  if (!target) return false;
  if (target.kind === 'material') {
    // W118: материал из expense row → SoT
    pushOsNav(
      { pathname: '/material/[id]', params: { id: target.pick.id } },
      options.returnTo,
      options.role ?? 'customer',
    );
    return true;
  }
  options.onDetail(target);
  return true;
}
