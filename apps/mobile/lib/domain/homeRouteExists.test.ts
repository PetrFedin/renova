/**
 * «Главная» в ссылках уведомлений должна существовать.
 *
 * Сервер клал в уведомления `return_to` и `link_path` вида
 * `/(customer)/(tabs)/home` — в 45 местах. Такого маршрута нет: главная живёт
 * по корню группы вкладок, файла `home.tsx` в `app/(role)/(tabs)/` не
 * существует.
 *
 * Проверено на живом приложении: адрес `/home` открывает экран «Такого экрана
 * нет. Маршрут «/home» устарел или не существует». То есть кнопка «Назад»
 * после перехода из любого такого уведомления упиралась в тупик.
 *
 * Запасной путь вёл туда же: неизвестный сегмент перенаправлялся на
 * `/(role)/(tabs)/index`, а сегмента `index` в адресе тоже нет.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

import { TAB_ALIASES, legacyRouteCanonical } from '../legacyRoutes';

const ROOT = new URL('../../', import.meta.url).pathname;
const redirect = readFileSync(`${ROOT}components/routing/LegacyTabRedirect.tsx`, 'utf8');

test('файла home.tsx нет — это и есть причина', () => {
  for (const role of ['(customer)', '(contractor)']) {
    assert.ok(
      !existsSync(`${ROOT}app/${role}/(tabs)/home.tsx`),
      `появился ${role}/(tabs)/home.tsx — проверка потеряла смысл`,
    );
    assert.ok(existsSync(`${ROOT}app/${role}/(tabs)/index.tsx`), 'главная лежит в index.tsx');
  }
});

test('старые ссылки из уже разосланных уведомлений ведут на главную', () => {
  assert.equal(legacyRouteCanonical('/(customer)/(tabs)/home'), '/(customer)/(tabs)/');
  assert.equal(legacyRouteCanonical('/(contractor)/(tabs)/home'), '/(contractor)/(tabs)/');
});

test('запасной путь не ведёт на несуществующий index', () => {
  assert.match(redirect, /pathname: `\/\(\$\{role\}\)\/\(tabs\)\/` as const/);
  assert.ok(
    !/\(tabs\)\/index` as const/.test(redirect),
    'запасной путь снова указывает на сегмент index, которого в адресе нет',
  );
});

test('прежние алиасы не тронуты', () => {
  assert.equal(TAB_ALIASES['/(customer)/(tabs)/works'], '/(customer)/(tabs)/repair?tab=works');
  assert.equal(TAB_ALIASES['/(contractor)/(tabs)/objects'], '/(contractor)/(tabs)/');
  assert.equal(TAB_ALIASES['/(customer)/(tabs)/finance'], '/(customer)/(tabs)/budget');
});

test('неизвестный маршрут остаётся собой, а не подменяется', () => {
  assert.equal(legacyRouteCanonical('/(customer)/(tabs)/repair'), '/(customer)/(tabs)/repair');
});
