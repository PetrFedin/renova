process.env.TZ = 'Europe/Moscow';
/** Живой аудит 3: подписи и формат дат, найденные в обходе исполнителя. */
import assert from 'node:assert/strict';
import { buildBreadcrumb } from './breadcrumb';
import { invoiceCountLabel } from './domain/invoiceCountLabel';
import { offlineQueuedMessage } from './offlineQueuedMessage';
import { formatScheduleDayFull, formatEventDateTime, formatClockTime, parseServerInstant } from './formatScheduleDate';

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

// A3-04: подпись действия в офлайн-сообщении не склоняется как подлежащее.
assert.match(offlineQueuedMessage('Приёмка'), /^Действие «Приёмка» поставлено в очередь/);
assert.match(offlineQueuedMessage(), /^Действие поставлено в очередь/);

// A3-05: время без пояса — это UTC; в Москве 20:53 UTC = 23:53 (чат, счета, комментарии).
assert.equal(formatClockTime('2026-10-03T20:53:31.917400'), '23:53');
assert.equal(formatClockTime('2026-10-03T20:53:31+03:00'), '20:53');
assert.equal(formatClockTime(null), '');
assert.equal(parseServerInstant('2026-10-03 20:53')?.toISOString(), '2026-10-03T20:53:00.000Z');
assert.equal(formatEventDateTime('2026-10-03T20:53:31'), '03.10.2026 23:53');

// A3-06: «Оплатить 2 счетов» → «Оплатить 2 счёта».
assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22].map(invoiceCountLabel), ['1 счёт', '2 счёта', '4 счёта', '5 счетов', '11 счетов', '12 счетов', '21 счёт', '22 счёта']);

console.log('auditThree.test OK');
