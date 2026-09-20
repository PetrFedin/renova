/**
 * Подложка окна закрывает его — и должна об этом говорить.
 *
 * `SheetSurface` рисует под окном кнопку во весь экран: нажатие по затемнению
 * закрывает окно. Её имя бралось из `accessibilityLabel` самого окна, а
 * `ActionConfirmSheet` передаёт туда «Подтверждение: <заголовок>». Получалась
 * кнопка «Подтверждение: Принять КП?», которая на самом деле отменяет.
 *
 * Поймано на живом проходе демо: нажал её, ожидая подтверждения приёма КП, —
 * окно закрылось, запроса на сервер не ушло, и заявка осталась непринятой.
 * Такая подложка есть под каждым подтверждением в приложении.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const surface = readFileSync(`${ROOT}components/renova/SheetSurface.tsx`, 'utf8');
const confirm = readFileSync(`${ROOT}components/renova/ActionConfirmSheet.tsx`, 'utf8');

test('имя подложки говорит о закрытии', () => {
  assert.match(surface, /accessibilityLabel=\{title \? `Закрыть: \$\{title\}` : 'Закрыть окно'\}/);
});

test('подложка больше не берёт имя окна', () => {
  assert.ok(
    !/accessibilityLabel=\{accessibilityLabel \?\? 'Закрыть окно'\}/.test(surface),
    'подложка снова называется именем окна — «Подтверждение: …», хотя отменяет',
  );
});

test('само окно по-прежнему называет себя', () => {
  // Имя нужно панели: читалка объявляет его при открытии.
  assert.match(surface, /accessibilityLabel=\{title \|\| value \|\| accessibilityLabel \|\| 'Окно Renova'\}/);
  assert.match(surface, /accessibilityViewIsModal/);
});

test('подтверждение по-прежнему передаёт своё имя', () => {
  assert.match(confirm, /accessibilityLabel=\{`Подтверждение: \$\{title\}`\}/);
});

test('закрытие по подложке не изменилось', () => {
  assert.match(surface, /onPress=\{closeSafely\}/);
  assert.match(surface, /accessibilityState=\{\{ disabled: busy \}\}/);
});
