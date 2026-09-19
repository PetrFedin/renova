/**
 * `useFocusEffect` не должен зависеть от функции, которую сам же и вызывает.
 *
 * Измерено на живом приложении: вход на экран «Ремонт» давал **419 запросов
 * за 10 секунд** при серверном лимите 120 в минуту. Дальше всё отвечало 429,
 * и экран этапа навсегда оставался на «Загрузка…» — рабочий тупик.
 *
 * Механика цикла: `refreshWorks` вызывает `loadProject`, тот кладёт в контекст
 * НОВЫЙ объект проекта, ссылка меняется, `refreshWorks` пересоздаётся,
 * колбэк `useFocusEffect` пересоздаётся — эффект запускается снова.
 *
 * Правильный приём в этом же коде уже есть: `useProjectDataReload` держит
 * колбэк в ref и поэтому не зациклен. Здесь то же самое закрепляется для
 * экрана работ.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const screen = readFileSync(`${ROOT}components/screens/OsWorksScreen.tsx`, 'utf8');

/** Тело `useFocusEffect(...)` вместе со списком зависимостей. */
function focusEffectBlocks(source: string): string[] {
  const blocks: string[] = [];
  let index = source.indexOf('useFocusEffect(');
  while (index !== -1) {
    let depth = 0;
    let end = index;
    for (let i = index + 'useFocusEffect'.length; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(source.slice(index, end + 1));
    index = source.indexOf('useFocusEffect(', end);
  }
  return blocks;
}

test('экран работ обновляется при фокусе один раз, а не по кругу', () => {
  const blocks = focusEffectBlocks(screen);
  assert.ok(blocks.length > 0, 'useFocusEffect на экране не найден — проверка потеряла смысл');

  for (const block of blocks) {
    const deps = block.slice(block.lastIndexOf('['), block.lastIndexOf(']') + 1);
    assert.ok(
      !/refreshWorks\b/.test(deps),
      'колбэк обновления в зависимостях эффекта: он сам меняет проект и '
        + `перезапустит себя же — ${deps}`,
    );
  }
});

test('актуальная версия колбэка берётся через ref', () => {
  // Пустой список зависимостей без ref заморозил бы первый колбэк навсегда —
  // это другая ошибка, не лучше цикла.
  assert.match(screen, /refreshWorksRef\.current = refreshWorks/);
  assert.match(screen, /refreshWorksRef\.current\(\)/);
});

test('зависимости обновления — идентификаторы, а не объекты', () => {
  // `activeProject` целиком в зависимостях — это новая ссылка после каждой
  // загрузки проекта, то есть тот же цикл с другой стороны.
  const start = screen.indexOf('const refreshWorks = useCallback(');
  assert.ok(start > 0, 'refreshWorks не найден');
  const deps = screen.slice(screen.indexOf('}, [', start), screen.indexOf(']);', start) + 3);
  assert.ok(
    !/\bactiveProject,/.test(deps),
    `объект проекта в зависимостях вместо идентификатора: ${deps.replace(/\s+/g, ' ')}`,
  );
  assert.ok(
    !/\buser,/.test(deps),
    `объект пользователя в зависимостях вместо идентификатора: ${deps.replace(/\s+/g, ' ')}`,
  );
});
