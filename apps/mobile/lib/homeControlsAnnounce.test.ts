/**
 * Нажимаемое обязано называть себя.
 *
 * Найдено обходом живого приложения с чтением дерева доступности
 * (`read_page filter=interactive`). На главной шесть элементов читались как
 * `button` без имени либо как `generic` — то есть нажимаются, но читалка не
 * говорит, что именно нажимается:
 *
 *   generic  "Системы: 3 требуют внимания"   ← бейдж интеграций
 *   button   ""                              ← «Заявки и новые объекты»
 *   button   ""                              ← «Подробнее →»
 *   button   ""                              ← плитка KPI «Материалы»
 *   button   ""                              ← плитка KPI «Сроки»
 *   generic  "Назад" / generic "На главную"  ← шапка каждого экрана со стеком
 *
 * У шапки имя было, а роли не было: `accessibilityLabel` без
 * `accessibilityRole` оставляет элемент текстом. Это худший случай из списка —
 * BackHeader стоит на каждом экране со стеком.
 *
 * Проверка текстовая (без рендера RN): она стережёт сам факт, что у
 * нажимаемого есть и роль, и имя.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');

const back = read('components/renova/BackHeader.tsx');
const badge = read('components/renova/IntegrationHonestyBadge.tsx');
const linkRow = read('components/renova/os/HomeLinkRow.tsx');
const zone = read('components/renova/os/HomeZone.tsx');
const widget = read('components/renova/os/OsWidgetStrip.tsx');
const week = read('components/renova/os/WeekScheduleStrip.tsx');

/**
 * Один `<Pressable …>` целиком.
 *
 * Регулярное выражение здесь не годится: `onPress={() => …}` содержит `>`,
 * и нежадный поиск обрывает тег на стрелке. Считаем фигурные скобки и берём
 * `>` только на нулевой глубине.
 */
function pressables(source: string): string[] {
  const tags: string[] = [];
  const open = /<Pressable\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source))) {
    let depth = 0;
    for (let i = match.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        tags.push(source.slice(match.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

const SURFACES: [string, string][] = [
  ['шапка экрана', back],
  ['бейдж интеграций', badge],
  ['строка-ссылка главной', linkRow],
  ['заголовок зоны главной', zone],
  ['плитки KPI', widget],
  ['план на неделю', week],
];

for (const [name, source] of SURFACES) {
  test(`${name}: у каждого нажимаемого есть роль`, () => {
    const found = pressables(source);
    assert.ok(found.length > 0, 'Pressable не найден — проверка потеряла смысл');
    for (const tag of found) {
      if (!/onPress/.test(tag)) continue; // декоративная обёртка без нажатия
      assert.match(
        tag,
        /accessibilityRole=/,
        `нажимаемое без роли — читалка объявит его текстом:\n${tag}`,
      );
    }
  });

  test(`${name}: у каждого нажимаемого есть имя`, () => {
    for (const tag of pressables(source)) {
      if (!/onPress/.test(tag)) continue;
      assert.match(
        tag,
        /accessibilityLabel=/,
        `нажимаемое без имени — читалка скажет «кнопка» и замолчит:\n${tag}`,
      );
    }
  });
}

test('шапка: имя без роли больше не повторится', () => {
  // Именно эта пара и была сломана: label стоял, role — нет.
  for (const label of ['"Назад"', '"На главную"']) {
    const idx = back.indexOf(`accessibilityLabel=${label}`);
    assert.ok(idx > 0, `кнопка ${label} пропала из шапки`);
    const tag = pressables(back).find((t) => t.includes(`accessibilityLabel=${label}`));
    assert.ok(tag, `кнопка ${label} больше не Pressable`);
    assert.match(tag, /accessibilityRole="button"/);
  }
});

test('плитка KPI произносит то же, что видит глаз', () => {
  assert.match(widget, /\[it\.label, it\.value, it\.hint\]/);
});

test('плитка KPI не диктует прочерк вместо «нет данных»', () => {
  // `—` рисуется как пустое значение; вслух это лишний слог без смысла.
  assert.match(widget, /part !== '—'/);
  assert.match(widget, /part !== '-'/);
});

test('ссылка зоны называет свою зону', () => {
  // На главной таких ссылок несколько, и все назывались бы одинаково.
  assert.match(zone, /accessibilityLabel=\{title \? `\$\{title\}: \$\{linkLabel\}` : linkLabel\}/);
});

test('бейдж интеграций сообщает, свернётся он или развернётся', () => {
  assert.match(badge, /expanded \? 'Свернуть' : 'Подробнее'/);
  assert.match(badge, /accessibilityState=\{\{ expanded \}\}/);
});
