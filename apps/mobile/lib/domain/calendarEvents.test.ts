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
  { id: '6', kind: 'stage_started', title: 'Старт этапа', date: '2026-07-06' },
], 'customer');
assert.equal(noisy.length, 1);

// Легаси-набор kind'ов сверяется с backend: каждый фильтруемый kind реально существует.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const cal = readFileSync(join(__dirname, '../../../../backend/app/services/calendar_service.py'), 'utf8');
const backendKinds = new Set([...cal.matchAll(/"kind": "(\w+)"/g)].map((m) => m[1]));
assert.ok(backendKinds.has('stage_started'));
const src = readFileSync(join(__dirname, 'calendarEvents.ts'), 'utf8');
const legacy = src.match(/const legacy = new Set\(\[([^\]]+)\]/);
assert.ok(legacy, 'legacy set found');
for (const k of [...legacy![1].matchAll(/'(\w+)'/g)].map((m) => m[1])) {
  assert.ok(backendKinds.has(k), `calendarEvents filters unknown kind '${k}'`);
}

console.log('calendarEvents.test.ts ok');
