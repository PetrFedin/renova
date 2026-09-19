/**
 * Решение по материалу двустороннее: согласовать и отклонить.
 *
 * Сервер отдаёт оба маршрута, клиентский метод `rejectMaterialPick` написан
 * целиком — вместе с офлайн-очередью — и **не вызывался ниоткуда**. Заказчику
 * предлагали только «Согласовать»: сказать «нет» было нечем.
 *
 * Найдено сверкой маршрутов API с вызовами из приложения: `approveMaterialPick`
 * вызывался с трёх экранов, `rejectMaterialPick` — с нуля.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const detail = readFileSync(`${ROOT}app/material/[id].tsx`, 'utf8');
const sheet = readFileSync(`${ROOT}components/renova/MaterialPickDetailSheet.tsx`, 'utf8');
const modal = readFileSync(`${ROOT}components/renova/RejectStageModal.tsx`, 'utf8');

const SURFACES: [string, string][] = [
  ['экран материала', detail],
  ['шторка материала', sheet],
];

for (const [name, source] of SURFACES) {
  test(`${name}: рядом с согласованием есть отклонение`, () => {
    assert.match(source, /approveMaterialPick/, 'согласование пропало — проверка потеряла смысл');
    assert.match(
      source,
      /rejectMaterialPick/,
      'согласовать можно, отклонить нечем — решение одностороннее',
    );
  });

  test(`${name}: отклонение спрашивает причину`, () => {
    // Отказ без причины не даёт исполнителю понять, что менять.
    assert.match(source, /RejectStageModal/);
    // Причина принимается — неважно, встроенной функцией или ссылкой на неё.
    assert.match(source, /onConfirm=\{/);
    assert.match(
      source,
      /\breason\b/,
      'причина нигде не упоминается — отклонение уйдёт без объяснения',
    );
  });
}

test('причина доходит до сервера, а не теряется по дороге', () => {
  assert.match(detail, /rejectMaterialPick\(user\.id, activeProject\.id, pick\.id, reason\)/);
  assert.match(sheet, /rejectMaterialPick\(userId, projectId, pick\.id, reason\)/);
});

test('пустая причина заменяется внятной, а не пустотой', () => {
  // Сервер принимает reason=null, но «отклонено без причины» бесполезно.
  for (const [, source] of SURFACES) {
    assert.match(source, /fallbackReason="Не подходит"/);
  }
});

test('быстрые причины этапа не переносятся на материал', () => {
  // Шаблоны вроде «Требуется доработка» осмысленны для работ, но не для
  // выбранной плитки.
  for (const [, source] of SURFACES) {
    assert.match(source, /showTemplates=\{false\}/);
  }
});

test('прежнее отклонение этапа не изменилось', () => {
  // Модалка стала общей — значения по умолчанию обязаны сохранить прежний вид.
  assert.match(modal, /fallbackReason = 'Требуется доработка'/);
  assert.match(modal, /showTemplates = true/);
  assert.match(modal, /title \?\? `Отклонить: \$\{stageName\}`/);
});

test('отклонение объясняет, что будет дальше', () => {
  const nav = readFileSync(`${ROOT}lib/procurementNav.ts`, 'utf8').replace(/\s+/g, ' ');
  assert.match(nav, /Материал отклонён/);
  assert.match(nav, /предложит замену/);
});
