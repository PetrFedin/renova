/**
 * Оценка, посчитанная на устройстве, не должна выдавать себя за рыночную.
 *
 * При любом отказе `api.marketEstimate` панель подставляла
 * `fallbackMarketEstimate` — расчёт по средним ставкам региона прямо в
 * приложении — и показывала его теми же словами и теми же цифрами, что и
 * настоящую рыночную оценку. Отличить было нечем, а по этим цифрам человек
 * прикидывает бюджет ремонта.
 *
 * Проверено на живом приложении: при сорванном запросе появляется
 * предупреждение и кнопка повтора; после повтора с рабочей сетью
 * предупреждение исчезает.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fallbackMarketEstimate } from '../../constants/regions';

const ROOT = new URL('../../', import.meta.url).pathname;
const panel = readFileSync(`${ROOT}components/renova/BudgetPlannerPanel.tsx`, 'utf8');
const regions = readFileSync(`${ROOT}constants/regions.ts`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const panelText = panel.replace(/\s+/g, ' ');

const INPUT = { region_code: 'msk', work_types: ['painting'], floor_sq_m: 20, complexity: 1 };

test('запасной расчёт помечает себя', () => {
  assert.equal(fallbackMarketEstimate(INPUT as never).computed_locally, true);
});

test('запасной расчёт по-прежнему считает', () => {
  // Он полезен без связи: грубый ориентир лучше пустого экрана.
  const fb = fallbackMarketEstimate(INPUT as never);
  assert.ok(fb.grand_total > 0);
  assert.ok(fb.labor_total > 0 && fb.materials_total > 0);
  assert.equal(Math.round(fb.labor_share + fb.materials_share), 1);
});

test('экран говорит, что цифры местные и грубые', () => {
  assert.match(panelText, /Рыночные цены не загрузились/);
  assert.match(panelText, /расчёт сделан на устройстве по средним ставкам региона/);
  assert.match(panelText, /Цифры грубые/);
});

test('из предупреждения есть выход', () => {
  assert.match(panelText, /accessibilityLabel="Повторить загрузку рыночных цен"/);
  assert.match(panel, /onPress=\{\(\) => \{ void recalc\(\); \}\}/);
});

test('предупреждение показывается только для местного расчёта', () => {
  assert.match(panel, /\{est\.computed_locally \? \(/);
});

test('настоящая оценка метки не несёт', () => {
  // Сервер поля не присылает — значит `undefined`, и предупреждения нет.
  assert.ok(!/computed_locally: true/.test(panel), 'панель сама себе ставит метку');
  assert.equal(regions.match(/computed_locally: true/g)?.length, 1);
});

test('сама оценка не изменилась', () => {
  // Правка о честности, а не о числах: формула запасного расчёта та же.
  const fb = fallbackMarketEstimate(INPUT as never);
  assert.equal(fb.reserve, Math.round((fb.labor_total + fb.materials_total) * 0.05));
  assert.equal(fb.grand_total, Math.round((fb.labor_total + fb.materials_total) * 1.05));
});
