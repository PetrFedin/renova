#!/usr/bin/env node
/**
 * Нажимаемый элемент берётся из `@/components/ui/Pressable`, а не из react-native.
 *
 * Обёртка даёт отклик в момент касания и вид выключенного состояния. Импорт
 * штатного `Pressable` напрямую возвращает элемент, который на палец никак не
 * реагирует: человек жмёт, под пальцем ничего не меняется, и до появления
 * результата он не знает, попал ли он вообще. Именно так было у 396 из 410
 * элементов.
 *
 * Тип `PressableStateCallbackType` импортировать из react-native можно — это
 * тип, а не компонент.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MOBILE = join(ROOT, 'apps/mobile');
const WRAPPER = join(MOBILE, 'components/ui/Pressable.tsx');

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx$/.test(entry)) yield full;
  }
}

const problems = [];
for (const base of ['components', 'app']) {
  for (const file of files(join(MOBILE, base))) {
    if (file === WRAPPER) continue;
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, index) => {
      if (!/from ['"]react-native['"]/.test(line)) return;
      if (/^\s*import\s+type\s/.test(line)) return;
      // Внутри фигурных скобок ищем именно значение Pressable, не тип.
      const named = line.match(/import\s*\{([^}]*)\}/);
      if (!named) return;
      const values = named[1]
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n && !n.startsWith('type '));
      if (values.includes('Pressable')) {
        problems.push({ file: relative(ROOT, file), line: index + 1 });
      }
    });
  }
}

if (problems.length === 0) {
  console.log('press-feedback: OK — нажимаемые элементы берутся из общей обёртки');
  process.exit(0);
}

console.error(`press-feedback: FAIL — ${problems.length} прямых импорта Pressable из react-native\n`);
for (const p of problems) console.error(`  ${p.file}:${p.line}`);
console.error("\nЗамените на: import { Pressable } from '@/components/ui/Pressable';");
process.exit(1);
