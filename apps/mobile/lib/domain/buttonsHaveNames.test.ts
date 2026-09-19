/**
 * Рубеж: нажимаемый элемент с ролью кнопки обязан иметь подпись.
 *
 * Найдено обходом живого приложения: дерево доступности главного экрана
 * показало **шесть** кнопок с пустым именем — «Системы: N требуют внимания»,
 * «Заявки и новые объекты», «Подробнее →», две плитки сводки и «Сроки».
 * Озвучка читает их все одинаково: «кнопка».
 *
 * Проверяются общие компоненты, через которые эти кнопки рисуются: починив
 * их, чинишь все экраны разом. Отдельные экраны намеренно не перебираются —
 * такой список устаревает быстрее, чем пишется.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;

/** Общие компоненты, рисующие нажимаемые строки и плитки. */
const SHARED_PRESSABLE_COMPONENTS = [
  'components/renova/os/HomeLinkRow.tsx',
  'components/renova/os/HomeZone.tsx',
  'components/renova/os/OsWidgetStrip.tsx',
  'components/renova/IntegrationHonestyBadge.tsx',
];

/** Блоки `<Pressable …>` вместе с их атрибутами. */
function pressableOpenings(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /<Pressable\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // До конца открывающего тега: следующий `>` вне фигурных скобок.
    let depth = 0;
    let end = match.index;
    for (let i = match.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    blocks.push(source.slice(match.index, end + 1));
  }
  return blocks;
}

for (const file of SHARED_PRESSABLE_COMPONENTS) {
  test(`${file}: у каждой кнопки есть подпись`, () => {
    const source = readFileSync(`${ROOT}${file}`, 'utf8');
    const unnamed = pressableOpenings(source).filter(
      (block) =>
        block.includes('accessibilityRole="button"') &&
        !block.includes('accessibilityLabel'),
    );
    assert.deepEqual(
      unnamed.map((block) => block.replace(/\s+/g, ' ').slice(0, 70)),
      [],
      'кнопка с ролью, но без подписи — озвучка прочитает её как «кнопка»',
    );
  });
}

test('плитка сводки называет и значение, и подсказку', () => {
  // «Сроки» без «12,5%» — половина смысла: пользователь слышит название
  // показателя и не слышит сам показатель.
  const source = readFileSync(`${ROOT}components/renova/os/OsWidgetStrip.tsx`, 'utf8');
  assert.match(source, /\[it\.label, it\.value, it\.hint\]/);
});

test('декоративная стрелка не читается вслух', () => {
  const source = readFileSync(`${ROOT}components/renova/os/HomeLinkRow.tsx`, 'utf8');
  // Именно разметка, а не упоминание стрелки в комментарии.
  const rendered = [...source.matchAll(/<Text\b[^>]*>\s*→\s*<\/Text>/g)].map((m) => m[0]);
  assert.ok(rendered.length > 0, 'стрелка в разметке не найдена — проверка потеряла смысл');
  for (const tag of rendered) {
    assert.match(
      tag,
      /accessibilityElementsHidden|importantForAccessibility="no"/,
      `стрелка — украшение, в озвучке ей делать нечего: ${tag.replace(/\s+/g, ' ')}`,
    );
  }
});

test('«Подробнее» не остаётся без раздела', () => {
  // Сама по себе эта подпись не говорит, к чему она относится.
  const source = readFileSync(`${ROOT}components/renova/os/HomeZone.tsx`, 'utf8');
  assert.match(source, /accessibilityLabel=\{[\s\S]*?title \?/);
});
