process.env.TZ = 'Europe/Moscow';
import assert from 'node:assert/strict';
import { localIsoDate, todayIso } from './localDate';

// 01:13 по Москве 2 октября = 22:13 UTC 1 октября: «сегодня» — 2 октября.
const lateNight = new Date('2026-10-01T22:13:00Z');
assert.equal(lateNight.toISOString().slice(0, 10), '2026-10-01');
assert.equal(localIsoDate(lateNight), '2026-10-02');
assert.equal(localIsoDate(new Date(2026, 9, 1)), '2026-10-01'); // местная полночь не уходит на сутки назад
assert.equal(localIsoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(todayIso(1) > todayIso(0), true);

console.log('localDate.test OK');
