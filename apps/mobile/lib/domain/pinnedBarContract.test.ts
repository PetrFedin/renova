/**
 * Контракт шапки закреплённых.
 *
 * Тайпчек здесь не помощник дважды. Он молча пропустил импорт компонента,
 * которого в этой ветке нет (`@/components/ui/Pressable` приходит из другой
 * незамёрженной ветки), и он же не видит несуществующие токены темы, потому
 * что тема типизирована свободно. На экране это дало бы падение при открытии
 * переписки и прозрачные элементы.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { RenovaTheme } from '../../constants/Theme';

const BAR = new URL('../../components/renova/chat/PinnedMessagesBar.tsx', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
const source = readFileSync(BAR, 'utf8');

test('каждый локальный импорт существует в этой ветке', () => {
  const imports = [...source.matchAll(/from '(@\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'локальных импортов не найдено — проверка бессмысленна');

  const missing = imports.filter((specifier) => {
    const relative = specifier.replace('@/', '');
    return !['.ts', '.tsx', '/index.ts', '/index.tsx'].some((suffix) =>
      existsSync(`${ROOT}${relative}${suffix}`),
    );
  });
  assert.deepEqual(missing, [], `импорт без файла в ветке: ${missing.join(', ')}`);
});

test('каждый токен темы существует', () => {
  const groups: Record<string, Record<string, unknown>> = {
    colors: RenovaTheme.colors,
    spacing: RenovaTheme.spacing,
    radius: RenovaTheme.radius,
    fontSize: RenovaTheme.fontSize,
    fontWeight: RenovaTheme.fontWeight,
  };
  const used = [...source.matchAll(/RenovaTheme\.(\w+)\.(\w+)/g)];
  assert.ok(used.length > 0, 'компонент должен брать оформление из темы');

  for (const [, group, token] of used) {
    const bag = groups[group];
    assert.ok(bag, `неизвестная группа токенов: RenovaTheme.${group}`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(bag, token),
      `RenovaTheme.${group}.${token} не существует`,
    );
  }
});

test('цвета не зашиты литералами мимо темы', () => {
  const hex = source.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `литеральные цвета: ${hex.join(', ')}`);
});

test('пустая шапка не рисуется', () => {
  assert.ok(
    /if \(!entries\.length\) return null;/.test(source),
    'без закреплений полоса займёт место и отнимет высоту у переписки',
  );
});

test('переход к сообщению озвучен', () => {
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityLabel=\{`Перейти к закреплённому сообщению/);
});
