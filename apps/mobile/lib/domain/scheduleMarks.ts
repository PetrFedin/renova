/** Маркеры дней для интерактивного календаря */
import type { CalendarEvent } from '@/lib/api';
import { calendarEventDates, isoDate, addDays, isWorkCalendarEvent } from '@/lib/domain/calendarEvents';

export { isoDate, addDays };

export type DayMark = {
  count: number;
  hasWork: boolean;
  hasStage: boolean;
  hasMaterial: boolean;
  hasPayment: boolean;
  overdue: boolean;
};

export function buildDayMarks(events: CalendarEvent[], today: string): Record<string, DayMark> {
  const map: Record<string, DayMark> = {};
  const bump = (date: string, patch: Partial<DayMark>) => {
    const cur = map[date] || { count: 0, hasWork: false, hasStage: false, hasMaterial: false, hasPayment: false, overdue: false };
    map[date] = {
      count: cur.count + (patch.count ?? 0),
      hasWork: cur.hasWork || !!patch.hasWork,
      hasStage: cur.hasStage || !!patch.hasStage,
      hasMaterial: cur.hasMaterial || !!patch.hasMaterial,
      hasPayment: cur.hasPayment || !!patch.hasPayment,
      overdue: cur.overdue || !!patch.overdue,
    };
  };

  for (const e of events) {
    const dates = calendarEventDates(e);
    for (const date of dates) {
      const overdue = date < today && (e.kind.startsWith('work_') || e.kind.startsWith('stage_')) && e.status !== 'done';
      bump(date, {
        count: 1,
        hasWork: isWorkCalendarEvent(e.kind),
        hasStage: e.kind.startsWith('stage_') || e.kind === 'contractor_ready',
        hasMaterial: e.kind === 'material',
        hasPayment: e.kind === 'payment',
        overdue,
      });
    }
  }
  return map;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - (day - 1));
  return x;
}
