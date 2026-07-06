/** Площадки проекта: этажи/зоны и циклы работ (этапы) */
import type { ProjectDetail, Stage, Room } from '@/lib/api';
import { floorGroups, roomPlan, roomReceiptTotal, roomMaterialTotal } from '@/lib/expenseSummary';
import type { ReceiptItem, MaterialPick, EstimateLine } from '@/lib/api';

export type ProjectSite = {
  id: string;
  floor: number;
  label: string;
  rooms: Room[];
  plan: number;
  spent: number;
  stages: Stage[];
  progressPercent: number;
};

export function buildProjectSites(
  project: ProjectDetail,
  receipts: ReceiptItem[] = [],
  picks: MaterialPick[] = [],
): ProjectSite[] {
  const lines: EstimateLine[] = project.estimate_lines || [];
  const stages: Stage[] = project.stages || [];
  const rooms: Room[] = project.rooms || [];

  if (!rooms.length) {
    return [{
      id: 'whole',
      floor: 0,
      label: 'Весь объект',
      rooms: [],
      plan: project.budget_planned,
      spent: project.budget_spent,
      stages,
      progressPercent: project.progress_percent,
    }];
  }

  return floorGroups(rooms).map(([floor, rs]) => {
    const plan = rs.reduce((a, r) => a + roomPlan(lines, r), 0);
    const receiptSpent = rs.reduce((a, r) => a + roomReceiptTotal(receipts, r.id), 0);
    const materialSpent = rs.reduce((a, r) => a + roomMaterialTotal(picks, r.id), 0);
    const spent = Math.max(receiptSpent, materialSpent, rs.length ? 0 : project.budget_spent);
    const roomIds = new Set(rs.map((r) => r.id));
    const siteStages = stages.filter((st) => {
      if (!st.room_ids?.length) return true;
      return st.room_ids.some((id) => roomIds.has(id));
    });
    const done = siteStages.filter((st) => st.status === 'done' || st.status === 'paid').length;
    const progressPercent = siteStages.length ? Math.round((done / siteStages.length) * 100) : project.progress_percent;

    return {
      id: `floor-${floor}`,
      floor,
      label: floor === 1 && project.property_type !== 'house' ? 'Квартира' : floor === 1 ? '1 этаж' : `${floor} этаж`,
      rooms: rs,
      plan: plan || project.budget_planned / Math.max(1, floorGroups(rooms).length),
      spent: spent || (floor === 1 ? project.budget_spent : 0),
      stages: siteStages,
      progressPercent,
    };
  });
}
