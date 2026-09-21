/**
 * Рубеж: в дереве git не должно быть симлинков с абсолютным путём.
 *
 * Причина, по которой они туда попадали: в .gitignore шаблоны стояли со
 * слешем — `node_modules/`, `backend/.venv/`, — а такой шаблон матчит только
 * каталоги. Симлинк с тем же именем каталогом не является и проскакивал в
 * коммит: с абсолютным путём внутри, то есть сломанным у всех, кроме машины,
 * где его создали.
 *
 * Так в ветку #551 уехал `backend/.venv → /Users/petr/renova/backend/.venv`.
 * Проверка по именам поймала бы и его, но только потому, что имя известно
 * заранее. Настоящее условие — не имя, а абсолютный путь: он не может быть
 * верным ни в одной другой проверке.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url).pathname;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** Пути и цели всех симлинков в индексе. Режим 120000 — симлинк. */
function indexedSymlinks() {
  return git(['ls-files', '-s'])
    .split('\n')
    .filter((line) => line.startsWith('120000'))
    .map((line) => {
      const [meta, path] = line.split('\t');
      const sha = meta.split(/\s+/)[1];
      return { path, target: git(['cat-file', '-p', sha]).trim() };
    });
}

test('ни один симлинк в индексе не указывает на абсолютный путь', () => {
  const absolute = indexedSymlinks().filter((link) => link.target.startsWith('/'));
  assert.deepEqual(
    absolute.map((l) => `${l.path} → ${l.target}`),
    [],
    'такой симлинк верен только на одной машине и сломан на всех остальных',
  );
});

test('ни один симлинк в индексе не выходит за пределы репозитория', () => {
  // `../../что-то` ломается так же тихо, как абсолютный путь.
  const escaping = indexedSymlinks().filter((link) => link.target.startsWith('../..'));
  assert.deepEqual(escaping.map((l) => `${l.path} → ${l.target}`), []);
});

test('вынесенные каталоги не лежат в индексе даже симлинком', () => {
  const VENDORED = new Set(['node_modules', '.venv']);
  const vendored = indexedSymlinks()
    .map((l) => l.path)
    .filter((path) => VENDORED.has(path.split('/').pop()));
  assert.deepEqual(vendored, [], `симлинки на вынесенные каталоги: ${vendored.join(', ')}`);
});

test('.gitignore ловит вынесенные каталоги и как каталог, и как симлинк', () => {
  const lines = readFileSync(`${repoRoot}.gitignore`, 'utf8')
    .split('\n')
    .map((line) => line.trim());

  for (const pattern of ['node_modules', 'backend/.venv']) {
    assert.ok(
      lines.includes(pattern),
      `шаблон должен быть \`${pattern}\` без слеша — со слешем он матчит только каталоги`,
    );
    assert.ok(
      !lines.includes(`${pattern}/`),
      `\`${pattern}/\` со слешем пропускает симлинк с тем же именем`,
    );
  }
});

test('проверка видит настоящий индекс, а не пустоту', () => {
  // Без этого всё выше проходило бы на сломанном вызове git.
  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  assert.ok(tracked.length > 100, `в индексе всего ${tracked.length} файлов — похоже, git не отработал`);
});
