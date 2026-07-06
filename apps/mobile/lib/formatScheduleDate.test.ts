import assert from 'node:assert/strict';
import {
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
