import { expenseFilterCounts, filterExpenseRows, receiptIdsFromRows } from './filterExpenseRows';
import type { ExpenseDetailRow } from './expenseAnalytics';

const rows: ExpenseDetailRow[] = [
  { id: 'rc-1', date: '2026-01-01', title: 'A', amount: 100, category: 'materials', categoryLabel: 'Материалы', kind: 'receipt', hasDocument: true, verified: true, stageId: 's1' },
  { id: 'rc-2', date: '2026-01-02', title: 'B', amount: 200, category: 'materials', categoryLabel: 'Материалы', kind: 'receipt', hasDocument: true, verified: false },
  { id: 'ex-1', date: '2026-01-03', title: 'C', amount: 50, category: 'labor', categoryLabel: 'Работа', kind: 'expense', hasDocument: false, stageId: 's1' },
];

if (filterExpenseRows(rows, 'no-stage').length !== 1) throw new Error('no-stage filter');
if (filterExpenseRows(rows, 'unverified').length !== 1) throw new Error('unverified filter');
const counts = expenseFilterCounts(rows);
if (counts.all !== 3 || counts['no-stage'] !== 1 || counts.unverified !== 1) throw new Error('counts');
if (receiptIdsFromRows(filterExpenseRows(rows, 'unverified')).join(',') !== '2') throw new Error('receipt ids');

console.log('filterExpenseRows.test OK');
