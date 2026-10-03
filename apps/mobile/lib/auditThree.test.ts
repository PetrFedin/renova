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

// --- Волна 2: «Открыто» живого аудита 3 ---
import { formatDecimal, formatPercentRu, formatSqm } from './formatDecimal';
import { neutralizeNextActionForReadOnly, stripOpenPayment } from './domain/readOnlyCopy';
import { stageAcceptedMessage, ACCEPTANCE_PIN_HINT } from './acceptanceCopy';
import { wasteDateLabel } from './domain/wasteOrderPolicy';
import { enteredByLabel, expensePayerLabel, NO_FNS_CHECK_LABEL, buildExpenseDetailRows } from './domain/expenseAnalytics';
import { paymentCheckLabel } from './domain/paymentReceiptCheck';
import { homeHeroLabel } from './domain/roleCapabilities';
import { buildProjectOsSnapshot } from './domain/buildProjectOsSnapshot';

// Дроби: запятая, без хвостовых нулей («12,5 %», «13,2 м²»).
assert.equal(formatDecimal(12.5), '12,5');
assert.equal(formatDecimal(13), '13');
assert.equal(formatDecimal('12.5'), '12,5');
assert.equal(formatPercentRu(12.5), '12,5 %');
assert.equal(formatSqm(13.2), '13,2 м²');
assert.equal(formatDecimal(null), '0');

// Гость «только просмотр»: нейтральные тексты, без призывов к заказчику.
const payAction = { title: 'Оплатить 2 счёта', subtitle: '11 000 ₽ к оплате', button: 'Оплатить', href: '/(customer)/(tabs)/budget?tab=payments&openPayment=1', kind: 'payment' as const };
const guestPay = neutralizeNextActionForReadOnly(payAction, { unpaid: 2, pendingPaymentTotalLabel: '11 000 ₽' });
assert.equal(guestPay.title, 'Выставлено 2 счёта');
assert.equal(guestPay.button, 'Счета');
assert.ok(!String(guestPay.href).includes('openPayment'));
assert.ok(!/Оплатить|оплат[а-я]+ь\b/.test(guestPay.title + guestPay.button));
const guestAccept = neutralizeNextActionForReadOnly(
  { title: 'Принять этап: Подготовка', subtitle: 'Этап ждёт приёмки', button: 'Принять этап', href: '/stage/1', kind: 'accept' },
  { unpaid: 0 },
);
assert.equal(guestAccept.title, 'На приёмке: Подготовка');
assert.equal(guestAccept.button, 'Статус');
const guestInvite = neutralizeNextActionForReadOnly(
  { title: 'Подключить исполнителя', subtitle: 'Без подрядчика…', button: 'Пригласить', href: '/profile', kind: 'review' },
  { unpaid: 0 },
);
assert.equal(guestInvite.title, 'Проект в работе');
assert.deepEqual(stripOpenPayment({ pathname: '/x', params: { tab: 'payments', openPayment: '1' } } as any), { pathname: '/x', params: { tab: 'payments' } });
assert.equal(homeHeroLabel({ role: 'customer', readOnly: true }), 'Состояние проекта');
assert.equal(homeHeroLabel({ role: 'customer' }), 'Очередь дел');

// buildProjectOsSnapshot(readOnly) сам нейтрализует CTA «Оплатить N счетов».
const proj: any = { id: 'p', name: 'P', stages: [], rooms: [], contractor_id: null, budget_planned: 0, estimate_lines: [] };
const dash: any = { progress_percent: 0 };
const snapCustomer = buildProjectOsSnapshot(proj, dash, [], [], [], [], null, 'customer', null, 0, 2, 11000);
assert.equal(snapCustomer.nextAction.title, 'Оплатить 2 счёта');
const snapGuest = buildProjectOsSnapshot(proj, dash, [], [], [], [], null, 'customer', null, 0, 2, 11000, undefined, true);
assert.equal(snapGuest.nextAction.title, 'Выставлено 2 счёта');
assert.equal(snapGuest.nextAction.button, 'Счета');

// «Этап принят»: метка на плане — только если план этажа есть.
assert.equal(stageAcceptedMessage(true), ACCEPTANCE_PIN_HINT);
assert.ok(!/план/i.test(stageAcceptedMessage(false)));

// Вывоз «Согласован» без даты — «Дата не назначена».
assert.equal(wasteDateLabel({ status: 'scheduled', scheduled_date: null }, formatScheduleDayFull), 'Дата не назначена');
assert.equal(wasteDateLabel({ status: 'scheduled', scheduled_date: '2026-10-05' }, formatScheduleDayFull), 'Дата вывоза: 05.10.2026');
assert.equal(wasteDateLabel({ status: 'draft', scheduled_date: null }, formatScheduleDayFull), null);

// BUD-19: платёж, подтверждённый чеком без ФНС, подписан; обычный — нет.
assert.equal(paymentCheckLabel({ status: 'confirmed', receipt_unverified: true }), NO_FNS_CHECK_LABEL);
assert.equal(paymentCheckLabel({ status: 'confirmed', receipt_unverified: false }), null);
assert.equal(paymentCheckLabel({ status: 'pending', receipt_unverified: true }), null);

// MNY-003: подпись автора ручного расхода.
assert.equal(enteredByLabel({ enteredByRole: 'contractor' }), 'внесён подрядчиком');
assert.equal(enteredByLabel({ enteredByRole: 'customer', enteredByName: 'Анна' }), 'внесён заказчиком (Анна)');
assert.equal(enteredByLabel({ enteredByRole: null }), null);
const manualRows = buildExpenseDetailRows(
  [{ id: 'r1', amount: 1500, verified: false, created_at: '2026-10-01T10:00:00', source: 'manual', description: 'Краска', entered_by_role: 'contractor' } as any],
  [], [], [], [],
);
assert.equal(manualRows[0].enteredByRole, 'contractor');
assert.equal(expensePayerLabel(manualRows[0]), 'Подрядчик');
