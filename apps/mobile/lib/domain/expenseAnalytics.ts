/** Агрегация расходов для таблиц и группировок */
import type { OsExpense, ReceiptItem, Room, Stage, MaterialPick } from '@/lib/api';
import { expenseCategoryLabel, EXPENSE_CATEGORY_LABEL } from '@/constants/labels';

export type ExpenseGroupMode = 'all' | 'day' | 'category' | 'room' | 'stage' | 'kind';

export type ExpenseDetailRow = {
  id: string;
  date: string;
  title: string;
  amount: number;
  category: string;
  categoryLabel: string;
  roomId?: string | null;
  roomName?: string;
  stageId?: string | null;
  stageName?: string;
  kind: 'receipt' | 'expense' | 'material';
  hasDocument: boolean;
  verified?: boolean;
};

export type ExpenseGroup = {
  key: string;
  label: string;
  total: number;
  plan?: number;
  rows: ExpenseDetailRow[];
};

function dayKey(iso?: string | null) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function roomName(rooms: Room[], id?: string | null) {
  if (!id) return undefined;
  return rooms.find((r) => r.id === id)?.name;
}

function stageName(stages: Stage[], id?: string | null) {
  if (!id) return undefined;
  return stages.find((st) => st.id === id)?.name;
}

/** Сводная таблица: чеки + ручные расходы + закупки материалов (без двойного учёта) */
export function buildExpenseDetailRows(
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  rooms: Room[],
  stages: Stage[],
): ExpenseDetailRow[] {
  const rows: ExpenseDetailRow[] = [];
  const receiptIds = new Set(receipts.map((r) => r.id));

  for (const r of receipts) {
    const cat = r.expense_category || 'materials';
    rows.push({
      id: `rc-${r.id}`,
      date: r.receipt_at || r.created_at,
      title: r.description || (r.fn ? `Чек ФН ${r.fn}` : 'Чек'),
      amount: r.amount,
      category: cat,
      categoryLabel: expenseCategoryLabel(cat),
      roomId: r.room_id,
      roomName: roomName(rooms, r.room_id),
      stageId: r.stage_id,
      stageName: stageName(stages, r.stage_id),
      kind: 'receipt',
      hasDocument: true,
      verified: r.verified,
    });
  }

  for (const e of expenses) {
    // OsExpense с receipt_id уже показан как чек — не дублируем строку
    if (e.receipt_id && receiptIds.has(e.receipt_id)) continue;
    rows.push({
      id: `ex-${e.id}`,
      date: e.expense_date || '',
      title: e.title,
      amount: e.amount,
      category: e.category,
      categoryLabel: EXPENSE_CATEGORY_LABEL[e.category] || e.category,
      roomId: e.room_id,
      roomName: roomName(rooms, e.room_id),
      stageId: e.stage_id,
      stageName: stageName(stages, e.stage_id),
      kind: 'expense',
      hasDocument: e.status !== 'pending_receipt',
    });
  }

  const coveredPickIds = new Set(
    expenses.map((e) => e.material_pick_id).filter(Boolean) as string[],
  );
  const receiptKeys = new Set(
    receipts.map((r) => `${r.room_id || ''}|${r.stage_id || ''}|${Math.round(r.amount)}`),
  );
  // W56: если есть Expense(purchase_id) — не дублируем purchased picks в fact
  const purchaseFactTotal = expenses
    .filter((e) => e.purchase_id && (e.status === 'confirmed' || e.status === 'pending_receipt'))
    .reduce((s, e) => s + e.amount, 0);

  for (const p of picks.filter((x) => x.status === 'purchased')) {
    if (purchaseFactTotal > 0) continue;
    const amt = p.total || p.qty * p.price;
    if (!amt) continue;
    if (coveredPickIds.has(p.id)) continue;
    const pickKey = `${p.room_id || ''}|${p.stage_id || ''}|${Math.round(amt)}`;
    if (receiptKeys.has(pickKey)) continue;
    rows.push({
      id: `mp-${p.id}`,
      date: '',
      title: p.name,
      amount: amt,
      category: 'materials',
      categoryLabel: 'Материалы',
      roomId: p.room_id,
      roomName: roomName(rooms, p.room_id),
      stageId: p.stage_id,
      stageName: stageName(stages, p.stage_id),
      kind: 'material',
      hasDocument: false,
    });
  }

  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** Кто оплатил трату — для прозрачности «сам / подрядчик» */
export function expensePayerLabel(row: ExpenseDetailRow): string {
  if (row.kind === 'material') return 'Подрядчик';
  if (row.kind === 'receipt') return 'Вы';
  return 'Учёт';
}

/** Факт по комнате/этапу — чеки + osExpenses + материалы без дублей (как в «Бюджет → Расходы») */
export function sumExpenseRowsForRoom(rows: ExpenseDetailRow[], roomId: string): number {
  return rows.filter((r) => r.roomId === roomId).reduce((a, r) => a + r.amount, 0);
}

export function sumExpenseRowsForStage(rows: ExpenseDetailRow[], stageId: string): number {
  return rows.filter((r) => r.stageId === stageId).reduce((a, r) => a + r.amount, 0);
}

export function roomSpentUnified(
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  rooms: Room[],
  stages: Stage[],
  roomId: string,
): number {
  const rows = buildExpenseDetailRows(receipts, expenses, picks, rooms, stages);
  return sumExpenseRowsForRoom(rows, roomId);
}

export function stageSpentUnified(
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  rooms: Room[],
  stages: Stage[],
  stageId: string,
): number {
  const rows = buildExpenseDetailRows(receipts, expenses, picks, rooms, stages);
  return sumExpenseRowsForStage(rows, stageId);
}

export function groupExpenseRows(rows: ExpenseDetailRow[], mode: ExpenseGroupMode): ExpenseGroup[] {
  if (mode === 'all') {
    const total = rows.reduce((a, r) => a + r.amount, 0);
    return [{ key: 'all', label: 'Все операции', total, rows }];
  }

  const map = new Map<string, ExpenseGroup>();
  for (const row of rows) {
    let key: string;
    let label: string;
    switch (mode) {
      case 'day':
        key = dayKey(row.date);
        label = key === '—' ? 'Без даты' : new Date(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        break;
      case 'category':
        key = row.category;
        label = row.categoryLabel;
        break;
      case 'room':
        key = row.roomId || 'none';
        label = row.roomName || 'Общие';
        break;
      case 'stage':
        key = row.stageId || 'none';
        label = row.stageName || 'Без этапа';
        break;
      case 'kind':
        key = row.kind;
        label = row.kind === 'receipt' ? 'Чеки' : row.kind === 'material' ? 'Закупки' : 'Ручные';
        break;
      default:
        key = 'all';
        label = 'Все';
    }
    const g = map.get(key) || { key, label, total: 0, rows: [] };
    g.total += row.amount;
    g.rows.push(row);
    map.set(key, g);
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}
