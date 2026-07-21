import { buildUnifiedBudgetExpenses, rowToExpenseTarget, unifiedExpenseTotal } from './buildUnifiedBudgetExpenses';
import { resolveExpenseRowTarget } from '@/lib/expenseRowTarget';

const rooms = [{ id: 'r1', name: 'Кухня' }] as any[];
const stages = [{ id: 's1', name: 'Плитка' }] as any[];

const receipts = [
  { id: 'rc1', amount: 1000, verified: true, created_at: '2026-06-01', expense_category: 'materials', room_id: 'r1' },
] as any[];

const expenses = [
  { id: 'ex1', title: 'Доставка', category: 'materials', amount: 500, status: 'confirmed', expense_date: '2026-06-02' },
] as any[];

const picks = [
  { id: 'p1', name: 'Плитка', status: 'purchased', qty: 2, price: 300, total: 600, room_id: 'r1', stage_id: 's1' },
] as any[];

// expense-дубль чека не попадает в список
const expensesWithReceiptDup = [
  ...expenses,
  { id: 'ex2', title: 'Чек дубль', category: 'materials', amount: 1000, status: 'confirmed', receipt_id: 'rc1', expense_date: '2026-06-01' },
] as any[];

const rowsDeduped = buildUnifiedBudgetExpenses(receipts, expensesWithReceiptDup, rooms, stages, picks);
if (rowsDeduped.length !== 3) throw new Error(`dedup receipt expense expected 3 got ${rowsDeduped.length}`);

const rows = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, picks);
if (rows.length !== 3) throw new Error('expected merged 3 rows');
if (rows[0].id !== 'ex-ex1') throw new Error('newest first');
if (unifiedExpenseTotal(rows) !== 2100) throw new Error('total sum');

const target = rowToExpenseTarget(rows[1], receipts, expenses);
if (!target || target.kind !== 'receipt' || target.item.id !== 'rc1') throw new Error('row mapping');

const materialRow = rows.find((row) => row.kind === 'material');
if (!materialRow) throw new Error('material row missing');
const materialTarget = resolveExpenseRowTarget(materialRow, receipts, expenses, picks);
if (!materialTarget || materialTarget.kind !== 'material' || materialTarget.pick.id !== 'p1') {
  throw new Error('material row mapping');
}

const purchaseExpenses = [
  ...expenses,
  { id: 'ex3', title: 'Закупка · Плитка', category: 'materials', amount: 600, status: 'confirmed', purchase_id: 'po-1', expense_date: '2026-06-03' },
] as any[];
const purchaseRows = buildUnifiedBudgetExpenses(
  receipts,
  purchaseExpenses,
  rooms,
  stages,
  [
    ...picks,
    { id: 'p2', name: 'Клей', status: 'purchased', qty: 1, price: 200, total: 200, room_id: 'r1', stage_id: 's1' },
  ] as any[],
  [{ id: 'po-1', items: [{ material_pick_id: 'p1' }] }] as any[],
);
if (purchaseRows.some((row) => row.id === 'mp-p1')) throw new Error('purchase-covered pick must be hidden');
if (!purchaseRows.some((row) => row.id === 'mp-p2')) throw new Error('uncovered purchased pick must remain visible');

console.log('buildUnifiedBudgetExpenses.test OK');

const approvedOnly = [
  { id: 'p2', name: 'Клей', status: 'approved', qty: 1, price: 900, total: 900, room_id: 'r1' },
] as any[];
const rowsApproved = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, approvedOnly);
if (rowsApproved.length !== 2) throw new Error('approved pick must not count as fact');
