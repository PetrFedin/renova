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

console.log('typecheck-mobile-report.test OK');
