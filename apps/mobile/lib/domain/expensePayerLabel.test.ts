import { expensePayerLabel, type ExpenseDetailRow } from './expenseAnalytics';

const receiptRow: ExpenseDetailRow = {
  id: 'r1', date: '2026-01-01', title: 'Чек', amount: 100, category: 'materials', categoryLabel: 'Материалы',
  kind: 'receipt', hasDocument: true,
};
const materialRow: ExpenseDetailRow = {
  id: 'm1', date: '', title: 'Клей', amount: 200, category: 'materials', categoryLabel: 'Материалы',
  kind: 'material', hasDocument: false,
};
const osRow: ExpenseDetailRow = {
  id: 'o1', date: '2026-01-02', title: 'Ручная', amount: 50, category: 'other', categoryLabel: 'Прочее',
  kind: 'os', hasDocument: false,
};

if (expensePayerLabel(receiptRow) !== 'Вы') throw new Error('receipt payer');
if (expensePayerLabel(materialRow) !== 'Подрядчик') throw new Error('material payer');
if (expensePayerLabel(osRow) !== 'Учёт') throw new Error('os payer');

console.log('expensePayerLabel.test OK');
