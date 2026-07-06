/** Сводка выполнения задач — для календаря и аналитики SLA */
import type { WorkOrder } from '@/lib/api';
import { isWorkArchived } from './workArchive';

export type ScheduleExecutionStats = {
  todayOpen: number;
  overdue: number;
  doneThisWeek: number;
  extensions: number;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildScheduleExecutionStats(workOrders: WorkOrder[], today: string): ScheduleExecutionStats {
  const weekStart = addDays(today, -6);
  let todayOpen = 0;
  let overdue = 0;
  let doneThisWeek = 0;
  let extensions = 0;

  for (const wo of workOrders) {
    const notes = wo.notes || '';
    if (/продлен|продление|запрос продления/i.test(notes)) extensions += 1;

    if (wo.status === 'done' && wo.updated_at && wo.updated_at.slice(0, 10) >= weekStart) {
      doneThisWeek += 1;
      continue;
    }
    if (isWorkArchived(wo.status)) continue;

    const start = wo.planned_start?.slice(0, 10);
    const end = (wo.planned_end || wo.planned_start)?.slice(0, 10);
    if (end && end < today && wo.status !== 'done') overdue += 1;
    if (start && end && start <= today && today <= end) todayOpen += 1;
    else if (start === today || end === today) todayOpen += 1;
  }

  return { todayOpen, overdue, doneThisWeek, extensions };
}
