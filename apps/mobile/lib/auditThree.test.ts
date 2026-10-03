/** Живой аудит 3: подписи и формат дат, найденные в обходе исполнителя. */
import assert from 'node:assert/strict';
import { buildBreadcrumb } from './breadcrumb';
import { formatScheduleDayFull, formatEventDateTime } from './formatScheduleDate';

// A3-02: крошка экрана «Профиль» не называется «Данные объекта» (это вкладка Объект → Данные объекта).
for (const role of ['customer', 'contractor'] as const) {
  const crumbs = buildBreadcrumb(role, '/(tabs)/profile');
  assert.equal(crumbs[crumbs.length - 1].label, 'Профиль');
}
const objectProfile = buildBreadcrumb('customer', '/(tabs)/object', { hubTab: 'profile' });
assert.equal(objectProfile[objectProfile.length - 1].label, 'Данные объекта');

// A3-01: даты этапов/приёмки/ленты — дд.мм.гггг, а не ISO.
assert.equal(formatScheduleDayFull('2026-10-06'), '06.10.2026');
assert.equal(formatScheduleDayFull(undefined), '—');
assert.match(formatEventDateTime('2026-10-03 20:32:00'), /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);

console.log('auditThree.test OK');
