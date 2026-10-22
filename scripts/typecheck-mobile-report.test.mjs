import assert from 'node:assert/strict';
import { analyzeTypecheckOutput, evaluateTypecheckRun } from './typecheck-mobile-report.mjs';

const noiseOnly = analyzeTypecheckOutput([
  "app/a.tsx(1,1): error TS2786: 'View' cannot be used as a JSX component.",
  "app/b.tsx(2,1): error TS2607: JSX element class does not support attributes.",
].join('\n'));
assert.deepEqual(noiseOnly, {
  total: 2,
  ignored2786: 1,
  ignored2607: 1,
  real: 0,
  realLines: [],
});

const mixed = analyzeTypecheckOutput([
  "app/a.tsx(1,1): error TS2786: ignored JSX noise",
  "lib/api.ts(3,4): error TS2322: Type 'string' is not assignable to type 'number'.",
  "lib/api.ts(3,4): error TS2322: Type 'string' is not assignable to type 'number'.",
  "lib/other.ts(5,1): error TS7006: Parameter 'value' implicitly has an 'any' type.",
].join('\n'));
assert.equal(mixed.total, 4);
assert.equal(mixed.ignored2786, 1);
assert.equal(mixed.real, 3, 'diagnostic count preserves repeated compiler errors');
assert.equal(mixed.realLines.length, 2, 'display output deduplicates identical lines');

assert.equal(evaluateTypecheckRun({ output: '', tscExitCode: 0, baseline: 0 }).ok, true);
assert.equal(evaluateTypecheckRun({
  output: "lib/api.ts(1,1): error TS2322: mismatch",
  tscExitCode: 2,
  baseline: 1,
}).ok, true, 'known real errors at the baseline are reported but accepted');

const exceeded = evaluateTypecheckRun({
  output: [
    "lib/a.ts(1,1): error TS2322: mismatch",
    "lib/b.ts(1,1): error TS7006: implicit any",
  ].join('\n'),
  tscExitCode: 2,
  baseline: 1,
});
assert.equal(exceeded.ok, false);
assert.match(exceeded.errors.join(' '), /exceed baseline/);

const strict = evaluateTypecheckRun({
  output: "lib/a.ts(1,1): error TS2322: mismatch",
  tscExitCode: 2,
  baseline: 5,
  strict: true,
});
assert.equal(strict.ok, false);
assert.match(strict.errors.join(' '), /strict mode/);

const toolingFailure = evaluateTypecheckRun({
  output: 'npm ERR! could not determine executable to run',
  tscExitCode: 1,
  baseline: 117,
});
assert.equal(toolingFailure.ok, false, 'tooling crash cannot be interpreted as zero errors');
assert.match(toolingFailure.errors.join(' '), /no TypeScript diagnostics/);

const inconsistentSuccess = evaluateTypecheckRun({
  output: "lib/a.ts(1,1): error TS2322: mismatch",
  tscExitCode: 0,
  baseline: 117,
});
assert.equal(inconsistentSuccess.ok, false, 'successful tsc exit with diagnostics fails closed');
assert.match(inconsistentSuccess.errors.join(' '), /exited successfully/);

assert.throws(
  () => evaluateTypecheckRun({ output: '', tscExitCode: 'not-a-number', baseline: 0 }),
  /non-negative integer/,
);
assert.throws(
  () => evaluateTypecheckRun({ output: '', tscExitCode: 0, baseline: -1 }),
  /non-negative integer/,
);

// --- Рубеж не должен молчать в зависимости от того, как его позвали. ---
//
// `import.meta.url` разыменован, а `process.argv[1]` — нет. На macOS `/tmp`
// это симлинк на `/private/tmp`, и запуск по пути внутри такого каталога
// давал несовпадение: модуль тихо ничего не делал, ни строки вывода, код
// возврата 0. То есть проверка типов «проходила» при любых ошибках.
//
// Поймать это импортом нельзя — нужен подзапуск, как в бою.
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const reportPath = fileURLToPath(new URL('./typecheck-mobile-report.mjs', import.meta.url));
  const sandbox = mkdtempSync(path.join(tmpdir(), 'typecheck-gate-'));
  const realDir = path.join(sandbox, 'real');
  const linkDir = path.join(sandbox, 'link');
  mkdirSync(realDir);
  symlinkSync(realDir, linkDir);

  const diagnostics = path.join(realDir, 'tsc.txt');
  writeFileSync(
    diagnostics,
    "components/Foo.tsx(1,1): error TS2307: Cannot find module '@/lib/nope'.\n",
  );

  const run = (entry) => {
    try {
      const stdout = execFileSync(process.execPath, [entry, `--input=${diagnostics}`, '--tsc-exit=2', '--baseline=0'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout };
    } catch (error) {
      return { code: error.status, stdout: String(error.stdout ?? '') + String(error.stderr ?? '') };
    }
  };

  // Прямой путь: рубеж обязан упасть на настоящей ошибке.
  const direct = run(reportPath);
  assert.equal(direct.code, 1, 'рубеж не упал на настоящей ошибке по прямому пути');
  assert.match(direct.stdout, /real errors 1 exceed baseline 0/);

  // И главное: запуск по несимволическому «двойнику» пути самого модуля.
  const aliasDir = path.join(sandbox, 'alias');
  symlinkSync(path.dirname(reportPath), aliasDir);
  const viaAlias = run(path.join(aliasDir, path.basename(reportPath)));
  assert.equal(
    viaAlias.code,
    1,
    'рубеж промолчал при запуске через симлинк — именно так он и пропускал ошибки',
  );
  assert.match(viaAlias.stdout, /real errors 1 exceed baseline 0/);

  rmSync(sandbox, { recursive: true, force: true });
}

console.log('typecheck-mobile-report.test OK');
