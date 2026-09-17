#!/usr/bin/env node
/**
 * Ratcheted ESLint gate for the mobile app.
 *
 * `tsc` covers types and the backend now has ruff and mypy, but nothing caught
 * the class of mistake that type-checks fine and misbehaves at runtime. The
 * first run found one live rendering bug: the regex that strips a leading
 * status glyph was written without the `u` flag, so the hammer emoji counted
 * as two code units. Stripping it from '🔨 В работе' removed only the high
 * surrogate and left the low one behind, and the stage status rendered as
 * "\udd28 В работе".
 *
 * Ratcheted the same way as npm audit, mobile typecheck and the backend lint
 * baseline: counts are recorded per rule, may only shrink, and anything new
 * fails. Nothing is auto-fixed.
 *
 *   node scripts/check-mobile-eslint-baseline.mjs            # enforce
 *   node scripts/check-mobile-eslint-baseline.mjs --list     # what and where
 *   node scripts/check-mobile-eslint-baseline.mjs --update   # re-record
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE = join(REPO_ROOT, 'scripts', 'mobile-eslint-baseline.json');
const ESLINT = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');

function run() {
  let raw;
  try {
    raw = execFileSync(ESLINT, ['apps/mobile/**/*.{ts,tsx}', '-f', 'json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // ESLint exits non-zero when it reports errors; the JSON is still on stdout.
    raw = error.stdout;
    if (!raw) {
      console.error('eslint produced no output:');
      console.error(error.stderr || error.message);
      process.exit(2);
    }
  }
  return JSON.parse(raw);
}

const results = run();

const counts = {};
const locations = {};
for (const file of results) {
  for (const message of file.messages) {
    const rule = message.ruleId ?? '(parse-error)';
    counts[rule] = (counts[rule] ?? 0) + 1;
    (locations[rule] ??= []).push(
      `${file.filePath.replace(`${REPO_ROOT}/`, '')}:${message.line} ${message.message.slice(0, 100)}`,
    );
  }
}

const mode = process.argv[2];

if (mode === '--list') {
  for (const [rule, hits] of Object.entries(locations).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${rule} (${hits.length})`);
    for (const hit of hits) console.log(`  ${hit}`);
  }
  process.exit(0);
}

if (mode === '--update') {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`,
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`baseline written: ${total} findings across ${Object.keys(counts).length} rules`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

const failures = [];
for (const [rule, count] of Object.entries(counts)) {
  const allowed = baseline[rule] ?? 0;
  if (count > allowed) failures.push(`${rule}: ${allowed} -> ${count}`);
  else if (count < allowed) console.log(`  ${rule} improved ${allowed} -> ${count} (run --update)`);
}
for (const [rule, allowed] of Object.entries(baseline)) {
  if (!(rule in counts) && allowed) console.log(`  ${rule} fully resolved (${allowed} -> 0)`);
}

if (failures.length > 0) {
  console.error('\nNew ESLint findings:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nSee where: node scripts/check-mobile-eslint-baseline.mjs --list');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`mobile eslint baseline OK (${total} known findings)`);
