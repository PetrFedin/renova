/**
 * Динамика цены должна показывать изменение, а не шесть одинаковых полос.
 *
 * Ширина считалась как `Math.min(100, p.index)`, а сервер отдаёт `index`
 * в пределах 103–108. Значит каждая полоса упиралась в 100 %, и все шесть
 * выходили одной длины при разнице значений около шести процентов. Ровно это
 * и было на экране: шесть синих линий, по которым ничего не понять.
 *
 * Живые значения, на которых проверено:
 *   апр 16 596 · май 17 206 · июн 17 022 · июл 16 832 · авг 16 801 · сен 17 588
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TREND_MIN_SHARE,
  trendBarShare,
  trendMonthLabel,
  trendSummary,
  trendSummaryText,
} from './priceTrend';

const LIVE = [
  { month: '2026-04', label: 'Apr 2026', total: 16596, index: 105 },
  { month: '2026-05', label: 'May 2026', total: 17206, index: 108 },
  { month: '2026-06', label: 'Jun 2026', total: 17022, index: 106 },
  { month: '2026-07', label: 'Jul 2026', total: 16832, index: 104 },
  { month: '2026-08', label: 'Aug 2026', total: 16801, index: 103 },
  { month: '2026-09', label: 'Sep 2026', total: 17588, index: 107 },
];

const ROOT = new URL('../../', import.meta.url).pathname;
const panel = readFileSync(`${ROOT}components/renova/BudgetPlannerPanel.tsx`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const panelText = panel.replace(/\s+/g, ' ');

test('полосы перестали быть одинаковыми', () => {
  const summary = trendSummary(LIVE)!;
  const widths = LIVE.map((p) => trendBarShare(p.total, summary.min, summary.max));
  assert.equal(new Set(widths.map((w) => Math.round(w * 100))).size > 1, true);
  // Самый дешёвый месяц — самая короткая полоса, самый дорогой — полная.
  assert.equal(trendBarShare(summary.min, summary.min, summary.max), TREND_MIN_SHARE);
  assert.equal(trendBarShare(summary.max, summary.min, summary.max), 1);
});

test('прежняя формула действительно давала одинаковые полосы', () => {
  // Не гипотеза: index у всех точек выше ста.
  const old = LIVE.map((p) => Math.min(100, p.index));
  assert.deepEqual(new Set(old), new Set([100]));
});

test('самый дешёвый месяц виден, а не исчезает', () => {
  // Нулевая длина читается как «данных нет».
  assert.ok(TREND_MIN_SHARE > 0);
});

test('одинаковые значения не ломают шкалу', () => {
  assert.equal(trendBarShare(100, 100, 100), 1);
});

test('месяцы подписаны по-русски', () => {
  assert.equal(trendMonthLabel('2026-04'), 'апр 2026');
  assert.equal(trendMonthLabel('2026-09'), 'сен 2026');
  assert.equal(trendMonthLabel('2026-12'), 'дек 2026');
});

test('непонятный формат месяца не ломает подпись', () => {
  assert.equal(trendMonthLabel('', 'Apr 2026'), 'Apr 2026');
  assert.equal(trendMonthLabel('2026-13', 'Sep 2026'), 'Sep 2026');
});

test('итог по периоду считается от первого к последнему', () => {
  const summary = trendSummary(LIVE)!;
  assert.equal(summary.direction, 'up');
  assert.equal(summary.changePct, 6);
  assert.equal(summary.min, 16596);
  assert.equal(summary.max, 17588);
});

test('падение цены названо падением', () => {
  const down = trendSummary([
    { month: '2026-04', label: '', total: 20000, index: 100 },
    { month: '2026-05', label: '', total: 18000, index: 100 },
  ])!;
  assert.equal(down.direction, 'down');
  assert.match(trendSummaryText(down), /дешевле/);
});

test('почти неизменная цена не выдаётся за движение', () => {
  const flat = trendSummary([
    { month: '2026-04', label: '', total: 10000, index: 100 },
    { month: '2026-05', label: '', total: 10010, index: 100 },
  ])!;
  assert.equal(flat.direction, 'flat');
  assert.equal(trendSummaryText(flat), 'Цена почти не менялась');
});

test('одной точки для вывода мало', () => {
  assert.equal(trendSummary([LIVE[0]]), null);
  assert.equal(trendSummaryText(null), '');
});

test('на экране сказано, что означает длина полосы', () => {
  assert.match(panelText, /Как менялась цена этого набора работ/);
  assert.match(panelText, /Длина полосы — цена месяца относительно самого дешёвого и самого дорогого за период/);
});

test('оговорка сервера не потеряна', () => {
  assert.match(panel, /\{est\.disclaimer\}/);
});
