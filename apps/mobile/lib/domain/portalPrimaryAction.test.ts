/**
 * У портала одно главное действие за раз.
 *
 * Гостевой экран — первое, что видит новый заказчик, — мог показать пять
 * синих кнопок одновременно: «Согласовать график», «Принять этап»,
 * «Согласовать» (доп. работы), «Зафиксировать смету», «Подписать». Все
 * одинаково выделенные, все равнозначные, и непонятно, с чего начинать.
 * Канон приложения прямо запрещает больше одного primary CTA на экран.
 *
 * Плюс строка «Сейчас: …» считала только приёмку, оплату и подпись: человек
 * читал «приёмка 2», а ниже его ждало ещё три решения.
 */
import assert from 'node:assert/strict';
import {
  PORTAL_DECISION_ORDER,
  buildPortalPendingSummary,
  firstPortalDecision,
  portalDecisionVariant,
  type PortalDecision,
} from './portalActions';

// --- одно главное действие ---------------------------------------------------

const everything = {
  schedule: true,
  acceptance: true,
  changeOrder: true,
  estimate: true,
  payment: true,
  document: true,
};

const first = firstPortalDecision(everything);
assert.equal(first, 'schedule', 'главным должно быть первое сверху решение');

const primaries = PORTAL_DECISION_ORDER.filter(
  (d) => portalDecisionVariant(d, first) === 'primary',
);
assert.equal(
  primaries.length,
  1,
  `на экране ${primaries.length} главных кнопок: ${primaries.join(', ')}`,
);

// ...и ни одно действие не исчезло — остальные просто вторичны.
const secondary = PORTAL_DECISION_ORDER.filter(
  (d) => portalDecisionVariant(d, first) === 'outline',
);
assert.equal(secondary.length, PORTAL_DECISION_ORDER.length - 1);

// --- главное сдвигается вниз по мере принятия решений -------------------------
// Страховка от «всегда график»: когда график согласован, главным становится
// следующее решение, а не «ничего».

let pending: Partial<Record<PortalDecision, boolean>> = { ...everything };
const seen: (PortalDecision | null)[] = [];
for (let step = 0; step < PORTAL_DECISION_ORDER.length; step += 1) {
  const current = firstPortalDecision(pending);
  seen.push(current);
  if (current) pending = { ...pending, [current]: false };
}
assert.deepEqual(seen, [...PORTAL_DECISION_ORDER]);
assert.equal(firstPortalDecision(pending), null, 'решений не осталось — главного нет');

// --- решения через одно ------------------------------------------------------
// Пропуски не должны сбивать порядок.

assert.equal(firstPortalDecision({ estimate: true, document: true }), 'estimate');
assert.equal(firstPortalDecision({ payment: true, document: true }), 'payment');
assert.equal(firstPortalDecision({ document: true }), 'document');
assert.equal(portalDecisionVariant('document', 'document'), 'primary');

// --- когда решать нечего, главного нет --------------------------------------

assert.equal(firstPortalDecision({}), null);
for (const decision of PORTAL_DECISION_ORDER) {
  assert.equal(
    portalDecisionVariant(decision, null),
    'outline',
    'без ожидающих решений ни одна кнопка не должна быть главной',
  );
}

// --- «Сейчас: …» считает всё, что ждёт заказчика -----------------------------

const summary = buildPortalPendingSummary({
  pending_acceptances: [{}, {}],
  pending_payments: [{}],
  pending_draft_documents: [{}],
  pending_work_schedule: { id: 's1' },
  pending_change_orders: [{}, {}, {}],
  estimate_summary: { proposed_at: '2026-09-01', locked_at: null },
});
assert.equal(summary.total, 2 + 1 + 1 + 1 + 3 + 1, 'сводка недосчитала решения');
assert.equal(
  summary.label,
  'график · приёмка 2 · доп. работы 3 · смета · оплата 1 · подпись 1',
  `порядок частей должен повторять порядок секций: ${summary.label}`,
);

// Зафиксированная смета решения уже не ждёт.
const locked = buildPortalPendingSummary({
  estimate_summary: { proposed_at: '2026-09-01', locked_at: '2026-09-05' },
});
assert.equal(locked.total, 0);
assert.equal(locked.label, 'Нет срочных действий');

// Пустой объект не должен падать и не должен выдумывать решения.
const empty = buildPortalPendingSummary({});
assert.equal(empty.total, 0);
assert.equal(empty.label, 'Нет срочных действий');

console.log('portalPrimaryAction.test OK');

// --- и то же самое на самом экране ------------------------------------------
// Правило может быть верным, а экран его не звать. Проверяем проводку.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screen = readFileSync(
  join(import.meta.dirname, '../../components/screens/PortalScreen.tsx'),
  'utf8',
);

for (const decision of PORTAL_DECISION_ORDER) {
  assert.ok(
    screen.includes(`portalDecisionVariant('${decision}', firstDecision)`),
    `кнопка решения «${decision}» не спрашивает, главная ли она`,
  );
}

// Демо-режим раньше делал кнопку оплаты заметнее боевого — этого больше нет.
assert.ok(
  !screen.includes("payments_mode === 'demo' ? 'primary'"),
  'вид кнопки оплаты всё ещё зависит от demo-режима',
);

console.log('portalPrimaryAction.screen.test OK');
