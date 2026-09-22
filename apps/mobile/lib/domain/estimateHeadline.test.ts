/**
 * Итог на экране сметы сходится с разбивкой под ним.
 *
 * Найдено при сверке цены договора с тем, что показывает приложение.
 *
 * Под подписью «Итого по смете» стоял `project.budget_planned`, а это
 * **смета плюс одобренные доп. работы** (`sync_project_budget_planned`).
 * Строкой ниже — «Работы X · Материалы Y» из строк сметы.
 *
 * На демо-объекте:
 *
 *   Итого по смете           194 438 ₽   ← budget_planned
 *   Работы 113 630 · Материалы 72 308    ← 185 938 ₽
 *
 * Разрыв 8 500 ₽ ничем не объяснён — на том самом экране, где нажимают
 * «Согласовать и зафиксировать смету». В базе: строки сметы 185 937.70,
 * одобренная доп. работа 8 500.00, `budget_planned` 194 437.70.
 *
 * Само число верное — неверна подпись к нему.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { estimateHeadline } from './estimateHeadline';

const ROOT = new URL('../../', import.meta.url).pathname;
const screen = readFileSync(`${ROOT}components/screens/estimate/EstimateSummaryLayer.tsx`, 'utf8');

/** Числа демо-объекта, как они лежат в базе. */
const DEMO = { estimateTotal: 185937.7, budgetPlanned: 194437.7, approvedChangeOrders: 8500 };

test('с доп. работами итог называется договором, а не сметой', () => {
  const h = estimateHeadline(DEMO);
  assert.equal(h.label, 'Итого по договору');
  assert.equal(h.total, 194437.7);
});

test('слагаемое показывается, а не остаётся необъяснённым', () => {
  assert.equal(estimateHeadline(DEMO).changeOrders, 8500);
});

test('итог сходится со слагаемыми до копейки', () => {
  const h = estimateHeadline(DEMO);
  assert.equal(Math.round((DEMO.estimateTotal + (h.changeOrders ?? 0)) * 100) / 100, h.total);
});

test('без доп. работ подпись остаётся прежней', () => {
  // Проверка не должна проходить оттого, что подпись сменилась навсегда.
  const h = estimateHeadline({ estimateTotal: 185937.7, budgetPlanned: 185937.7, approvedChangeOrders: 0 });
  assert.equal(h.label, 'Итого по смете');
  assert.equal(h.total, 185937.7);
  assert.equal(h.changeOrders, null);
});

test('явный ноль с сервера не считается «неизвестно»', () => {
  const h = estimateHeadline({ estimateTotal: 100, budgetPlanned: 100, approvedChangeOrders: 0 });
  assert.equal(h.changeOrders, null);
  assert.equal(h.label, 'Итого по смете');
});

test('старый сервер без слагаемого всё равно не врёт про состав', () => {
  // Поле могло не приехать — но обещать «только смета» нельзя и тогда.
  const h = estimateHeadline({ estimateTotal: 185937.7, budgetPlanned: 194437.7 });
  assert.equal(h.label, 'Итого по договору');
  assert.equal(h.changeOrders, null, 'выводить слагаемое вычитанием не надо — это догадка');
});

test('копеечное расхождение не меняет подпись', () => {
  // Округление не повод объявлять доп. работы.
  const h = estimateHeadline({ estimateTotal: 185937.7, budgetPlanned: 185938.2 });
  assert.equal(h.label, 'Итого по смете');
});

test('крупное число и подпись берутся из одного места', () => {
  assert.match(screen, /<Text style=\{s\.totalLabel\}>\{headline\.label\}<\/Text>/);
  assert.match(screen, /<Text style=\{s\.total\}>\{formatRub\(headline\.total\)\}<\/Text>/);
  assert.ok(
    !/formatRub\(project\.budget_planned\)/.test(screen),
    'под подписью снова стоит число, состав которого не назван',
  );
});

test('строка со слагаемыми появляется только когда есть что объяснять', () => {
  assert.match(screen, /headline\.changeOrders != null \?/);
  assert.match(screen, /Доп\. работы \(согласованы\)/);
});

test('разбивка по работам и материалам сохранена', () => {
  assert.match(screen, /Работы \{formatRub\(totals\.works\)\}/);
  assert.match(screen, /Материалы \{formatRub\(totals\.materials\)\}/);
});

test('подтверждение фиксации называет тот же состав', () => {
  // Момент обязательства: раньше здесь стояло голое `budget_planned`.
  assert.match(screen, /\$\{headline\.label\}: \$\{formatRub\(headline\.total\)\}/);
  assert.match(screen, /Смета \$\{formatRub\(totals\.total\)\} \+ доп\. работы/);
});

test('предупреждение о необратимости фиксации сохранено', () => {
  assert.match(screen, /После фиксации базовые строки нельзя свободно менять/);
});
