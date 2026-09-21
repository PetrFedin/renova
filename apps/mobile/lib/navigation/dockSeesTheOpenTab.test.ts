/**
 * Док и крошки видят, какая вкладка открыта.
 *
 * Сообщено с экрана: «кнопка смета снизу при выборе не выделяется жирным,
 * только объект показывается странно».
 *
 * Обе кнопки «Смета» и «Объект» ведут на один и тот же маршрут `object`;
 * различает их параметр `tab=estimate`. Ровно по нему `activeDockItemId` и
 * решает, что подсветить.
 *
 * Но и док, и крошки рисует **макет** `(tabs)`, а не открытый экран. А
 * `useLocalSearchParams` отдаёт параметры своего маршрута — то есть макета.
 * Параметр `tab` принадлежит экрану `object`, и до макета он не доходил
 * вовсе: `tab` всегда был `undefined`.
 *
 * Отсюда оба симптома разом: «Смета» не подсвечивалась никогда, а путь
 * обрывался на «Объект» и не показывал, на какой вкладке человек стоит.
 *
 * Тот же приём уже применён в `OsRoleTabsNavigator`, где он и подписан:
 * «именно global: параметры нужны от открытого экрана, а не от самого
 * макета».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { activeDockItemId } from './navigationPolicy';
import { DOCK_PRESET_SETUP } from '../../constants/dockBar';

const ROOT = new URL('../../', import.meta.url).pathname;
const dock = readFileSync(`${ROOT}components/renova/os/OsDockBar.tsx`, 'utf8');
const crumbs = readFileSync(`${ROOT}components/renova/os/OsHeaderBreadcrumb.tsx`, 'utf8');

const ON_ESTIMATE = { pathname: '/(customer)/(tabs)/object', params: { tab: 'estimate' } };
const ON_OBJECT = { pathname: '/(customer)/(tabs)/object', params: {} };

test('док берёт параметры открытого экрана, а не макета', () => {
  assert.match(dock, /useGlobalSearchParams<Record<string, string \| string\[\]>>\(\)/);
  assert.ok(
    !/useLocalSearchParams/.test(dock),
    'локальный хук в макете не видит `tab` открытого экрана — «Смета» снова погаснет',
  );
});

test('крошки берут параметры открытого экрана, а не макета', () => {
  assert.match(crumbs, /const \{ tab, sub, filter \} = useGlobalSearchParams/);
});

test('на вкладке сметы подсвечивается «Смета»', () => {
  assert.equal(activeDockItemId(DOCK_PRESET_SETUP, ON_ESTIMATE), 'estimate');
});

test('без вкладки сметы подсвечивается «Объект»', () => {
  assert.equal(activeDockItemId(DOCK_PRESET_SETUP, ON_OBJECT), 'object');
});

test('потерянный `tab` даёт ровно тот симптом, о котором сообщили', () => {
  // Так вело себя приложение: параметр до макета не доходил.
  const asIfParamLost = { pathname: ON_ESTIMATE.pathname, params: {} };
  assert.equal(activeDockItemId(DOCK_PRESET_SETUP, asIfParamLost), 'object');
});

test('«Смета» подсвечивается только если она есть в доке', () => {
  // У дока без «Сметы» правильный ответ — «Объект», и это не regress.
  const withoutEstimate = ['home', 'chat', 'object', 'repair', 'budget'] as const;
  assert.equal(activeDockItemId(withoutEstimate, ON_ESTIMATE), 'object');
});

test('прочие вкладки дока не задеты', () => {
  const items = DOCK_PRESET_SETUP;
  assert.equal(activeDockItemId(items, { pathname: '/(customer)/(tabs)/', params: {} }), 'home');
  assert.equal(activeDockItemId(items, { pathname: '/(customer)/(tabs)/chat', params: {} }), 'chat');
  assert.equal(
    activeDockItemId(items, { pathname: '/(customer)/(tabs)/object', params: { tab: 'rooms' } }),
    'object',
  );
});

test('вкладка сметы узнаётся на всех маршрутах объекта', () => {
  for (const seg of ['object', 'rooms', 'estimate', 'plan']) {
    assert.equal(
      activeDockItemId(DOCK_PRESET_SETUP, {
        pathname: `/(customer)/(tabs)/${seg}`,
        params: { tab: 'estimate' },
      }),
      'estimate',
      `маршрут ${seg} не узнан`,
    );
  }
});

test('параметр-массив не ломает разбор', () => {
  // `useGlobalSearchParams` может отдать массив при повторе ключа в адресе.
  assert.equal(
    activeDockItemId(DOCK_PRESET_SETUP, {
      pathname: '/(customer)/(tabs)/object',
      params: { tab: ['estimate', 'rooms'] },
    }),
    'estimate',
  );
});
