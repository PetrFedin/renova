/**
 * Рубеж: в дереве git не должно быть симлинков на node_modules.
 *
 * Причина, по которой они туда попадали: в .gitignore стояло `node_modules/`
 * со слешем, а такой шаблон матчит только каталоги. Симлинк с тем же именем
 * каталогом не является и проскакивал в коммит — с абсолютным путём внутри,
 * то есть ломался у всех, кроме машины, где его создали.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url).pathname;

function gitLines(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

test('в индексе нет симлинков на node_modules', () => {
  // 120000 — режим симлинка в дереве git.
  const symlinks = gitLines(['ls-files', '-s'])
    .filter((line) => line.startsWith('120000'))
    .map((line) => line.split('\t')[1]);

  const vendored = symlinks.filter((path) => path.split('/').pop() === 'node_modules');
  assert.deepEqual(
    vendored,
    [],
    `симлинки на node_modules в индексе: ${vendored.join(', ')}`,
  );
});

test('.gitignore ловит node_modules и как каталог, и как симлинк', () => {
  const lines = readFileSync(`${repoRoot}.gitignore`, 'utf8')
    .split('\n')
    .map((line) => line.trim());

  assert.ok(
    lines.includes('node_modules'),
    'шаблон должен быть `node_modules` без слеша — со слешем он матчит только каталоги',
  );
  assert.ok(
    !lines.includes('node_modules/'),
    '`node_modules/` со слешем пропускает симлинк с тем же именем',
  );
});
