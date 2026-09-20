/**
 * Нажимаемое обязано объявлять себя нажимаемым.
 *
 * Снято с живого приложения, дерево доступности экрана «Ремонт → Этапы» до
 * правки:
 *
 *     button [ref_5]            ← крошка «Главная», без имени
 *     tab [ref_8]               ← вкладка «Этапы», без имени
 *     generic [ref_12]          ← фильтр «Сейчас (1)»
 *     generic [ref_16]          ← карточка этапа целиком
 *
 * Карточка этапа и фильтры были `generic`: читалка не объявляла их
 * нажимаемыми, а найти их можно было только зрячим касанием. Вкладки и крошки
 * роль имели, но были безымянными.
 *
 * Все четыре — общие элементы, поэтому правка одинаково поднимает каждый экран,
 * где они встречаются.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const card = readFileSync(`${ROOT}components/renova/WorkStageCard.tsx`, 'utf8');
const filter = readFileSync(`${ROOT}components/renova/SearchFilter.tsx`, 'utf8');
const tabs = readFileSync(`${ROOT}components/renova/os/OsHubTabs.tsx`, 'utf8');
const crumbs = readFileSync(`${ROOT}components/renova/os/OsHeaderBreadcrumb.tsx`, 'utf8');

const SHARED: [string, string][] = [
  ['карточка этапа', card],
  ['фильтры списка', filter],
  ['вкладки хаба', tabs],
  ['крошки пути', crumbs],
];

for (const [name, source] of SHARED) {
  test(`${name}: роль объявлена`, () => {
    assert.match(source, /accessibilityRole="(button|tab)"/, `${name} без роли`);
  });

  test(`${name}: имя объявлено`, () => {
    assert.match(source, /accessibilityLabel=/, `${name} без имени — в дереве будет пусто`);
  });
}

test('карточка этапа называет этап, состояние, срок и сумму', () => {
  const label = card.slice(card.indexOf('accessibilityLabel={['), card.indexOf('accessibilityState'));
  for (const part of ['stage.name', 'display_status_label', 'planned_end', 'formatRub']) {
    assert.ok(label.includes(part), `в озвучке карточки нет «${part}»`);
  }
});

test('пустые части не попадают в озвучку', () => {
  // Иначе читалка произносила бы «Демонтаж · · · 0 ₽».
  assert.match(card, /\.filter\(Boolean\)\.join\(' · '\)/);
});

test('состояние нажатого передаётся, а не только рисуется', () => {
  assert.match(card, /accessibilityState=\{\{ selected: !!selected, disabled: !!blocked \}\}/);
  assert.match(filter, /accessibilityState=\{\{ selected: active === f\.key \}\}/);
  assert.match(tabs, /accessibilityState=\{\{ selected: on \}\}/);
});

test('счётчик у вкладки озвучивается, а не теряется', () => {
  assert.match(tabs, /t\.badge != null && t\.badge > 0 \? `\$\{t\.label\}, \$\{t\.badge\}` : t\.label/);
});

test('текущая крошка называет себя текущей', () => {
  // Она отключена; без пояснения читалка сказала бы просто «недоступно».
  assert.match(crumbs, /isLast \? `\$\{c\.label\}, текущий раздел` : c\.label/);
});

test('подпись фильтра берётся целиком, вместе со счётчиком', () => {
  assert.match(filter, /accessibilityLabel=\{f\.label\}/);
});
