/**
 * Затемнение под окнами — одно на всё приложение.
 *
 * Сплошной разбор оформления нашёл пять разных значений на 18 мест:
 * `rgba(0,0,0,0.35)`, `rgba(0,0,0,0.4)`, `rgba(0,0,0,0.5)`,
 * `rgba(15,23,42,0.35)` и `rgba(15,23,42,0.45)` в самом `SheetSurface`.
 * Одинаковые по смыслу окна темнели по-разному, а половина из них — другим
 * базовым цветом.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const theme = readFileSync(`${ROOT}constants/Theme.ts`, 'utf8');
const surface = readFileSync(`${ROOT}components/renova/SheetSurface.tsx`, 'utf8');

/** Литералы затемнения по экранам и компонентам, кроме самого токена. */
function scrimLiterals(): string[] {
  const out = execSync(
    `grep -rn "rgba(0,0,0,0\\.\\|rgba(0, 0, 0, 0\\.\\|rgba(15,23,42\\|rgba(15, 23, 42" components app || true`,
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter(Boolean)
    // Подпись поверх камеры — не затемнение окна, у неё своя роль.
    .filter((line) => !line.includes('app/scan-receipt.tsx'));
}

test('токен объявлен в источнике правды', () => {
  assert.match(theme, /scrim: 'rgba\(15, 23, 42, 0\.45\)'/);
});

test('канонический шит берёт токен, а не литерал', () => {
  assert.match(surface, /backgroundColor: RenovaTheme\.colors\.scrim/);
  assert.ok(!/rgba\(15, 23, 42, 0\.45\)/.test(surface), 'в шите снова литерал');
});

test('литералов затемнения в окнах не осталось', () => {
  const left = scrimLiterals();
  assert.deepEqual(left, [], `окна снова темнеют по-своему:\n${left.join('\n')}`);
});

test('прежние цвета палитры не тронуты', () => {
  // Правка добавляет токен, а не переписывает соседние.
  assert.match(theme, /border: '#E2E8F0'/);
  assert.match(theme, /borderLight: '#F1F5F9'/);
});
