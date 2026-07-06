import { buildStageExpenseLinks } from './buildStageExpenseLinks';
import type { ExpenseDetailRow } from './expenseAnalytics';

const stages = [{ id: 's1', name: 'Плитка', status: 'active', room_ids: ['r1'] }] as any[];
const rooms = [{ id: 'r1', name: 'Ванная' }] as any[];

const rows: ExpenseDetailRow[] = [
  { id: 'rc-1', date: '2026-01-01', title: 'Чек', amount: 5000, category: 'materials', categoryLabel: 'Материалы', stageId: 's1', stageName: 'Плитка', roomId: 'r1', roomName: 'Ванная', kind: 'receipt', hasDocument: true },
  { id: 'mp-1', date: '', title: 'Клей', amount: 1200, category: 'materials', categoryLabel: 'Материалы', stageId: 's1', stageName: 'Плитка', roomId: 'r1', roomName: 'Ванная', kind: 'material', hasDocument: false },
];

const links = buildStageExpenseLinks(rows, stages, rooms, []);
if (links.length !== 1) throw new Error(`expected 1 link got ${links.length}`);
if (links[0].spent !== 6200) throw new Error(`spent expected 6200 got ${links[0].spent}`);
if (!links[0].roomNames.includes('Ванная')) throw new Error('room missing');

const approvedOnly = buildStageExpenseLinks([], stages, rooms, [
  { id: 'p2', name: 'X', status: 'approved', stage_id: 's1', room_id: 'r1', qty: 1, unit: 'шт', price: 999, total: 999 } as any,
]);
if (approvedOnly.length !== 0) throw new Error('approved pick must not create stage link without rows');

console.log('buildStageExpenseLinks.test OK');
