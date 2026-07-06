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

const noisy = filterCalendarEventsForRole([
  period,
  { id: '4', kind: 'contractor_ready', title: 'Готово', date: '2026-07-06' },
  { id: '5', kind: 'work_start', title: 'Старт', date: '2026-07-09' },
  { id: '6', kind: 'stage_start', title: 'Старт этапа', date: '2026-07-06' },
], 'customer');
assert.equal(noisy.length, 1);

console.log('calendarEvents.test.ts ok');
