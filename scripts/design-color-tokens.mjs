#!/usr/bin/env node
/**
 * Цвета интерфейса берутся из палитры, а не пишутся шестнадцатеричным литералом.
 *
 * Приложение было собрано из двух нейтральных рядов сразу: тема стоит на
 * slate, а часть экранов писала tailwind gray (`#6B7280`, `#E5E7EB`,
 * `#F9FAFB`). Ряды отличаются подтоном — slate синеватый, gray нейтральный, —
 * поэтому соседние блоки выглядели разного оттенка. Семантические поверхности
 * расходились так же: «ожидает» был `#FEF3C7`, а любой другой warning-фон —
 * `#FFFBEB`.
 *
 * Правило: литерал, который совпадает с токеном палитры или отличается от неё
 * незначительно, — ошибка. Цвета со своей ролью, которой в палитре нет,
 * перечислены в ALLOWED явно, с объяснением: список исключений должен быть
 * читаемым, а не молчаливым.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MOBILE = join(ROOT, 'apps/mobile');
const SCAN = ['components', 'app'].map((d) => join(MOBILE, d));

/** Насколько литерал может отличаться от токена, оставаясь «тем же цветом». */
const NEAR = 45;

/** Своя роль, токена в палитре нет. Каждая строка — почему. */
const ALLOWED = new Map([
  ['#FEF9C3', 'подсветка найденного текста в чате'],
  ['#FEF08A', 'подсветка совпадения в поиске'],
  ['#E0E7FF', 'цвет категории «материалы»'],
  ['#4338CA', 'текст категории «материалы»'],
  ['#000', 'тень'],
  ['#FFF', 'белый'],
  ['#FFFFFF', 'белый'],
]);

function palette() {
  const theme = readFileSync(join(MOBILE, 'constants/Theme.ts'), 'utf8');
  const out = new Map();
  for (const m of theme.matchAll(/^\s+([a-zA-Z]+): *'(#[0-9a-fA-F]{6})'/gm)) {
    if (!out.has(m[2].toUpperCase())) out.set(m[2].toUpperCase(), m[1]);
  }
  return out;
}

function distance(a, b) {
  const p = (s, i) => parseInt(s.slice(1).slice(i, i + 2), 16);
  return Math.abs(p(a, 0) - p(b, 0)) + Math.abs(p(a, 2) - p(b, 2)) + Math.abs(p(a, 4) - p(b, 4));
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules') continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

const tokens = palette();
const problems = [];

for (const dir of SCAN) {
  for (const file of files(dir)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, index) => {
      for (const m of line.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)) {
        const value = m[1].toUpperCase();
        if (ALLOWED.has(value)) continue;
        if (value.length !== 7) continue;
        let best = null;
        for (const [hex, name] of tokens) {
          const d = distance(value, hex);
          if (best === null || d < best.d) best = { d, hex, name };
        }
        if (best && best.d <= NEAR) {
          problems.push({
            file: relative(ROOT, file),
            line: index + 1,
            value,
            token: best.name,
            hex: best.hex,
            exact: best.d === 0,
          });
        }
      }
    });
  }
}

if (problems.length === 0) {
  console.log('design-color-tokens: OK — литералов из палитры нет');
  process.exit(0);
}

console.error(`design-color-tokens: FAIL — ${problems.length} литерал(ов) вместо токена\n`);
for (const p of problems) {
  const how = p.exact ? 'это и есть' : 'почти';
  console.error(`  ${p.file}:${p.line}  ${p.value} — ${how} RenovaTheme.colors.${p.token} (${p.hex})`);
}
console.error('\nВозьмите токен из constants/Theme.ts. Если у цвета своя роль,');
console.error('которой в палитре нет, — добавьте его в ALLOWED с объяснением.');
process.exit(1);
