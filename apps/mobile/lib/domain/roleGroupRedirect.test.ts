/**
 * Проверки к `roleGroupRedirect`: адрес один, групп две.
 *
 * Воспроизведено на живом приложении: под заказчиком открыть
 * `http://localhost:8081/object?tab=profile` — вкладка «Данные» показывает
 * подсказку «Исполнитель: уточняйте параметры с заказчиком», то есть экран
 * отрисован группой исполнителя.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { roleGroupPrefix, roleGroupRedirectPath } from './roleGroupRedirect';

test('своя группа не трогается', () => {
  assert.equal(roleGroupRedirectPath('customer', 'customer', '/object'), null);
  assert.equal(roleGroupRedirectPath('contractor', 'contractor', '/budget'), null);
});

test('чужая группа возвращает в свою, на тот же экран', () => {
  assert.equal(
    roleGroupRedirectPath('contractor', 'customer', '/object'),
    '/(customer)/(tabs)/object',
  );
  assert.equal(
    roleGroupRedirectPath('customer', 'contractor', '/repair'),
    '/(contractor)/(tabs)/repair',
  );
});

test('вложенный экран сохраняется целиком', () => {
  assert.equal(
    roleGroupRedirectPath('contractor', 'customer', '/object/plan'),
    '/(customer)/(tabs)/object/plan',
  );
});

test('корень не трогаем — иначе теряется экран из ссылки', () => {
  // На первом кадре после перезагрузки путь успевает побыть `/`. Главную по
  // роли разводит `app/index`, так что пропуск ничего не теряет.
  assert.equal(roleGroupRedirectPath('contractor', 'customer', '/'), null);
  assert.equal(roleGroupRedirectPath('contractor', 'customer', ''), null);
});

test('пока пользователь не загружен — никуда не уводим', () => {
  assert.equal(roleGroupRedirectPath('contractor', null, '/object'), null);
  assert.equal(roleGroupRedirectPath('contractor', undefined, '/object'), null);
});

test('неизвестная роль считается заказчиком — как во всём приложении', () => {
  // `osEntryRoute` и `tabsPrefix` трактуют всё, кроме contractor, как customer.
  assert.equal(
    roleGroupRedirectPath('contractor', 'guest', '/object'),
    '/(customer)/(tabs)/object',
  );
});

test('префикс совпадает с тем, которым ходит само приложение', () => {
  assert.equal(roleGroupPrefix('customer'), '/(customer)/(tabs)');
  assert.equal(roleGroupPrefix('contractor'), '/(contractor)/(tabs)');
});
