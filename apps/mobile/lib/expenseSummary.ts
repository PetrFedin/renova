/** Агрегация расходов: комнаты, этажи, материалы vs чеки */
import type { Room, ReceiptItem, EstimateLine, MaterialPick } from '@/lib/api';

export function roomReceiptTotal(receipts: ReceiptItem[], roomId: string) {
  return receipts.filter((r) => r.room_id === roomId).reduce((a, r) => a + r.amount, 0);
}

export function roomMaterialTotal(picks: MaterialPick[], roomId: string) {
  return picks
    .filter((p) => p.room_id === roomId && p.status === 'purchased')
    .reduce((a, p) => a + (p.total || p.qty * p.price), 0);
}

export function floorGroups(rooms: Room[]) {
  const m = new Map<number, Room[]>();
  for (const r of rooms) {
    const fl = r.floor_level ?? 1;
    if (!m.has(fl)) m.set(fl, []);
    m.get(fl)!.push(r);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export function roomPlan(lines: EstimateLine[], room: Room) {
  return lines
    .filter((l) => (l.room_id && l.room_id === room.id) || l.room_name === room.name)
    .reduce((a, l) => a + l.quantity_planned * l.unit_price, 0);
}

export function floorTotals(rooms: Room[], lines: EstimateLine[], receipts: ReceiptItem[], picks: MaterialPick[] = []) {
  return floorGroups(rooms).map(([floor, rs]) => {
    const plan = rs.reduce((a, r) => a + roomPlan(lines, r), 0);
    const receiptSpent = rs.reduce((a, r) => a + roomReceiptTotal(receipts, r.id), 0);
    const materialSpent = rs.reduce((a, r) => a + roomMaterialTotal(picks, r.id), 0);
    return { floor, rooms: rs, plan, receiptSpent, materialSpent, spent: Math.max(receiptSpent, materialSpent) };
  });
}
