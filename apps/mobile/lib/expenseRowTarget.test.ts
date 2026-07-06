import { resolveExpenseRowTarget } from './expenseRowTarget';

const receipts = [{ id: 'r1', amount: 100, description: 'Чек', created_at: '2026-01-01', verified: true }] as any[];
const expenses = [{ id: 'e1', amount: 50, title: 'Ручной', category: 'other', expense_date: '2026-01-02', status: 'confirmed' }] as any[];
const picks = [{ id: 'p1', name: 'Плитка', qty: 1, price: 200, total: 200, status: 'purchased' }] as any[];

const rc = resolveExpenseRowTarget({ id: 'rc-r1', kind: 'receipt' } as any, receipts, expenses, picks);
if (!rc || rc.kind !== 'receipt' || rc.item.id !== 'r1') throw new Error('receipt target failed');

const ex = resolveExpenseRowTarget({ id: 'ex-e1', kind: 'expense' } as any, receipts, expenses, picks);
if (!ex || ex.kind !== 'expense') throw new Error('expense target failed');

const mp = resolveExpenseRowTarget({ id: 'mp-p1', kind: 'material' } as any, receipts, expenses, picks);
if (!mp || mp.kind !== 'material' || mp.pick.id !== 'p1') throw new Error('material target failed');

console.log('expenseRowTarget.test OK');
