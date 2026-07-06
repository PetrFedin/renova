/** Связи этап → комнаты → траты (единый список расходов без дублей) */
import type { MaterialPick, Room, Stage } from '@/lib/api';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export type StageExpenseLink = {
  stageId: string;
  stageName: string;
  spent: number;
  roomNames: string[];
  materialCount: number;
  expenseCount: number;
};

export function buildStageExpenseLinks(
  rows: ExpenseDetailRow[],
  stages: Stage[],
  rooms: Room[],
  picks: MaterialPick[] = [],
): StageExpenseLink[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const roomMap = new Map(rooms.map((r) => [r.id, r.name]));
  const byStage = new Map<string, { spent: number; rooms: Set<string>; materials: number; count: number }>();

  for (const row of rows) {
    if (!row.stageId) continue;
    const cur = byStage.get(row.stageId) || { spent: 0, rooms: new Set<string>(), materials: 0, count: 0 };
    cur.spent += row.amount;
    cur.count += 1;
    if (row.roomName) cur.rooms.add(row.roomName);
    if (row.kind === 'material') cur.materials += 1;
    byStage.set(row.stageId, cur);
  }

  for (const p of picks.filter((x) => x.status === 'purchased')) {
    if (!p.stage_id) continue;
    const cur = byStage.get(p.stage_id) || { spent: 0, rooms: new Set<string>(), materials: 0, count: 0 };
    const rn = p.room_id ? roomMap.get(p.room_id) : undefined;
    if (rn) cur.rooms.add(rn);
    if (!rows.some((r) => r.id === `mp-${p.id}`)) cur.materials += 1;
    byStage.set(p.stage_id, cur);
  }

  return [...byStage.entries()]
    .map(([stageId, v]) => ({
      stageId,
      stageName: stageMap.get(stageId)?.name || 'Этап',
      spent: Math.round(v.spent * 100) / 100,
      roomNames: [...v.rooms],
      materialCount: v.materials,
      expenseCount: v.count,
    }))
    .filter((x) => x.spent > 0 || x.materialCount > 0 || x.expenseCount > 0)
    .sort((a, b) => b.spent - a.spent);
}
