/**
 * Контракт экрана объёмного вида.
 *
 * Тайпчек здесь не помощник: тема типизирована свободно, и несуществующий
 * токен вроде `colors.surfaceAlt` проходит проверку типов молча, а на экране
 * даёт прозрачную грань. Этот случай уже случился в этой же правке, поэтому
 * токены сверяются с темой напрямую.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RenovaTheme } from '../../constants/Theme';

const VIEW = new URL('../../components/renova/plan/Room3DView.tsx', import.meta.url).pathname;
const source = readFileSync(VIEW, 'utf8');

test('каждый токен темы в компоненте существует', () => {
  const groups: Record<string, Record<string, unknown>> = {
    colors: RenovaTheme.colors,
    spacing: RenovaTheme.spacing,
    radius: RenovaTheme.radius,
    fontSize: RenovaTheme.fontSize,
    fontWeight: RenovaTheme.fontWeight,
  };

  const used = [...source.matchAll(/RenovaTheme\.(\w+)\.(\w+)/g)];
  assert.ok(used.length > 0, 'компонент должен брать цвета из темы, а не из литералов');

  for (const [, group, token] of used) {
    const bag = groups[group];
    assert.ok(bag, `неизвестная группа токенов: RenovaTheme.${group}`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(bag, token),
      `RenovaTheme.${group}.${token} не существует — грань будет прозрачной`,
    );
  }
});

test('цвета не зашиты литералами мимо темы', () => {
  const hex = source.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `литеральные цвета в обход темы: ${hex.join(', ')}`);
});

test('заливка и обводка — отдельные фигуры', () => {
  // Вложенный <Path> в Skia рисуется как ещё одна фигура, а не как контур
  // первой: обводка при этом молча пропадает.
  // [^/]> — чтобы самозакрывающийся <Path ... /> не считался открывающим.
  assert.ok(
    !/<Path[^>]*[^/]>\s*<Path/.test(source),
    'обводка вложена в заливку — на экране её не будет',
  );
  assert.ok(source.includes('style="stroke"'), 'обводки нет вовсе');
});

test('каждая кнопка ракурса подписана для озвучки', () => {
  const buttons = [...source.matchAll(/<PrimaryButton([\s\S]*?)\/>/g)];
  assert.equal(buttons.length, 3, 'ожидались кнопки «Сверху», «Сбоку», «Сбросить»');
  for (const [, body] of buttons) {
    assert.ok(
      /accessibilityLabel=/.test(body),
      `кнопка без accessibilityLabel: ${body.trim().slice(0, 60)}`,
    );
  }
});

test('холст сам объясняет, что он такое и как им пользоваться', () => {
  assert.ok(
    source.includes('accessibilityLabel={`Объёмный вид комнаты.'),
    'без подписи холст для озвучки — пустой прямоугольник',
  );
  assert.ok(source.includes('Поворот протаскиванием'), 'жест ничем не объявлен');
});
