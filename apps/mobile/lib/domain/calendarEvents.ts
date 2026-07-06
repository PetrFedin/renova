/** Периоды этапов и задач в календаре — без дублей «Старт/Финиш». */
import type { CalendarEvent } from '@/lib/api';
import { formatScheduleDayShort, formatScheduleWorkSpan } from '@/lib/formatScheduleDate';

const PERIOD_KINDS = new Set(['stage_period', 'work_period']);

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

export function isPeriodCalendarEvent(kind: string): boolean {
  return PERIOD_KINDS.has(kind);
}

export function isStageCalendarEvent(kind: string): boolean {
  return kind === 'stage_period' || kind.startsWith('stage_') || kind === 'contractor_ready' || kind === 'customer_accepted';
}

export function isWorkCalendarEvent(kind: string): boolean {
  return kind === 'work_period' || kind.startsWith('work_');
}

/** Все ISO-дни, которые покрывает событие (для маркеров календаря). */
export function calendarEventDates(e: CalendarEvent): string[] {
  if (!e.date) return [];
  if (!isPeriodCalendarEvent(e.kind) || !e.end_date || e.end_date <= e.date) return [e.date];
  const out: string[] = [];
  let cur = new Date(`${e.date}T12:00:00`);
  const last = new Date(`${e.end_date}T12:00:00`);
  while (cur <= last) {
    out.push(isoDate(cur));
    cur = addDays(cur, 1);
  }
  return out;
}

/** День попадает в событие (в т.ч. внутри периода). */
export function calendarEventOnDate(e: CalendarEvent, iso: string): boolean {
  if (!e.date) return false;
  if (e.date === iso) return true;
  if (isPeriodCalendarEvent(e.kind) && e.end_date && e.date <= iso && iso <= e.end_date) return true;
  return false;
}

/** Период пересекается с окном [from, to] включительно. */
export function calendarEventInRange(e: CalendarEvent, from: string, to: string): boolean {
  const start = e.date;
  const end = isPeriodCalendarEvent(e.kind) && e.end_date ? e.end_date : e.date;
  return start <= to && end >= from;
}

export function formatCalendarEventDates(e: CalendarEvent): string {
  if (isPeriodCalendarEvent(e.kind)) {
    return formatScheduleWorkSpan(e.date, e.end_date || e.date) || '—';
  }
  return formatScheduleDayShort(e.date);
}

/** Заказчику — периоды без legacy «старт/финиш» и приёмок. */
export function filterCalendarEventsForRole(events: CalendarEvent[], role: 'customer' | 'contractor'): CalendarEvent[] {
  if (role !== 'customer') return events;
  const legacy = new Set(['contractor_ready', 'customer_accepted', 'stage_start', 'stage_end', 'work_start', 'work_due']);
  return events.filter((e) => !legacy.has(e.kind));
}

/** Сортировка дня: задачи → этапы → остальное. */
export function sortDayCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const rank = (k: string) => {
    if (k === 'work_period') return 0;
    if (k.startsWith('work_')) return 1;
    if (k === 'stage_period') return 2;
    if (k.startsWith('stage_')) return 3;
    if (k === 'material') return 4;
    return 5;
  };
  return [...events].sort((a, b) => rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title, 'ru'));
}

export function dayTaskCount(events: CalendarEvent[]): number {
  return events.filter((e) => e.kind === 'work_period' || e.kind === 'work_start').length;
}
