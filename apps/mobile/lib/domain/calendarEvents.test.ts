import assert from 'node:assert/strict';
import {
  calendarEventInRange,
  calendarEventOnDate,
  dayTaskCount,
  formatCalendarEventDates,
  filterCalendarEventsForRole,
  sortDayCalendarEvents,
} from './calendarEvents';
import type { CalendarEvent } from '@/lib/api';

const period: CalendarEvent = {
  id: '1',
  kind: 'stage_period',
  title: 'Подготовка',
  date: '2026-07-06',
  end_date: '2026-07-08',
};

const taskA: CalendarEvent = {
  id: '2',
  kind: 'work_period',
  title: 'Снятие сантехники',
  date: '2026-07-09',
};

const taskB: CalendarEvent = {
  id: '3',
  kind: 'work_period',
  title: 'Замена сантехники',
  date: '2026-07-09',
};

assert.equal(calendarEventOnDate(period, '2026-07-07'), true);
assert.equal(calendarEventOnDate(period, '2026-07-09'), false);
assert.equal(formatCalendarEventDates(period), '06.07 — 08.07');
assert.equal(calendarEventInRange(period, '2026-07-01', '2026-07-10'), true);

const day = sortDayCalendarEvents([period, taskB, taskA]);
assert.equal(day.filter((e) => e.kind === 'work_period').length, 2);
assert.equal(day[0].kind, 'work_period');
assert.equal(dayTaskCount([taskA, taskB, period]), 2);

// Виды событий — те, что реально отдаёт calendar_service.build_calendar.
// Прежде здесь стояли stage_start и work_start, которых сервер не отдаёт:
// тест подтверждал отсев того, что и так никогда не приходило.
const noisy = filterCalendarEventsForRole([
  period,
  { id: '4', kind: 'contractor_ready', title: 'Готово', date: '2026-07-06' },
  { id: '5', kind: 'customer_accepted', title: 'Принято', date: '2026-07-07' },
  { id: '6', kind: 'stage_started', title: 'Старт: Подготовка', date: '2026-07-06' },
  { id: '7', kind: 'payment', title: 'Оплата этапа', date: '2026-07-08' },
], 'customer');
assert.equal(noisy.map((e) => e.kind).join(','), 'stage_period,payment');

const forContractor = filterCalendarEventsForRole([
  period,
  { id: '6', kind: 'stage_started', title: 'Старт: Подготовка', date: '2026-07-06' },
], 'contractor');
assert.equal(forContractor.length, 2);

assert.equal(dayTaskCount([{ id: '8', kind: 'work_done', title: 'Готово', date: '2026-07-09' }]), 0);

console.log('calendarEvents.test.ts ok');
