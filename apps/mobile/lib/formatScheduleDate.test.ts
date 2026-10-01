import assert from 'node:assert/strict';
import {
  formatEventDateTime,
  formatScheduleDayFull,
  formatScheduleDayShort,
  formatScheduleRange,
  formatScheduleWorkSpan,
} from './formatScheduleDate';

assert.equal(formatScheduleDayShort('2026-06-28'), '28.06');
assert.equal(formatScheduleDayFull('2026-06-28'), '28.06.2026');
assert.equal(formatScheduleRange('2026-06-28', '2026-08-27'), '28.06.2026 — 27.08.2026');
assert.equal(formatScheduleWorkSpan('2026-06-28', '2026-06-28'), '28.06');
assert.equal(formatScheduleWorkSpan('2026-06-28', '2026-07-05'), '28.06 — 05.07');

console.log('formatScheduleDate.test OK');

// Время без пояса — UTC; на выводе местное (Москва, UTC+3).
process.env.TZ = 'Europe/Moscow';
assert.equal(formatEventDateTime('2026-10-01 21:36:12'), '02.10.2026 00:36');
assert.equal(formatEventDateTime('2026-10-01T21:36:12Z'), '02.10.2026 00:36');
assert.equal(formatEventDateTime(null), '—');
assert.equal(formatEventDateTime('не дата'), 'не дата');
