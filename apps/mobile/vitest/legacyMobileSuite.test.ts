/**
 * Automatic discovery for the mobile test files.
 *
 * `npm run mobile:test` is a single ~7000-character shell line chaining about a
 * hundred `tsx <file> &&` invocations. Three consequences, all observed:
 *
 *  - a test runs only if someone remembers to append it — 118 of 226 files
 *    never ran at all;
 *  - the first failure aborts the rest, so one broken file hides ~90 others;
 *  - there is no per-file reporting, no filtering and no parallelism.
 *
 * This spec replaces the chain's *discovery*, not its semantics. Each file is
 * executed in the same interpreter (`tsx` for .ts, `node` for .mjs) with the
 * same `TSX_TSCONFIG_PATH` and the same `fail-console-assert` hook, so a file
 * behaves exactly as it does today. What changes is that every file is found,
 * every file reports independently, and they run concurrently.
 *
 * The legacy `mobile:test` script is intentionally left in place: the
 * js-dependency-integrity workflow invokes it directly.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { QUARANTINED_MOBILE_TESTS, QUARANTINED_PATHS } from './quarantine';

const REPO_ROOT = resolve(__dirname, '../../..');
const MOBILE_ROOT = join(REPO_ROOT, 'apps/mobile');
const PER_FILE_TIMEOUT_MS = 60_000;

// This bridge lives under apps/mobile and matches *.test.ts itself. Running it
// through tsx would import `vitest` outside a Vitest worker and fail, so the
// directory holding native Vitest specs is excluded from legacy discovery.
const NATIVE_VITEST_DIR = 'vitest';

function discover(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.expo' ||
        (directory === MOBILE_ROOT && entry.name === NATIVE_VITEST_DIR)
      ) {
        continue;
      }
      discover(path, found);
    } else if (/\.test\.(ts|mjs)$/.test(entry.name) && !/\.vitest\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

interface RunResult {
  code: number | null;
  output: string;
}

function runLegacyTest(absolutePath: string): Promise<RunResult> {
  const isEsmScript = absolutePath.endsWith('.mjs');
  const command = isEsmScript ? 'node' : join(REPO_ROOT, 'node_modules/.bin/tsx');

  return new Promise((resolvePromise) => {
    const child = spawn(command, [absolutePath], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(MOBILE_ROOT, 'tsconfig.json'),
        // Same guard the legacy chain installs: a console.assert/error failure
        // must fail the file rather than scroll past.
        NODE_OPTIONS: `--require=${join(REPO_ROOT, 'scripts/fail-console-assert.cjs')}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise({ code: 124, output: `${output}\n[timed out after ${PER_FILE_TIMEOUT_MS}ms]` });
    }, PER_FILE_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, output: `${output}\n${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
  });
}

const discovered = discover(MOBILE_ROOT)
  .map((absolutePath) => ({
    absolutePath,
    relativePath: relative(REPO_ROOT, absolutePath),
  }))
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

const active = discovered.filter((entry) => !QUARANTINED_PATHS.has(entry.relativePath));
const quarantined = discovered.filter((entry) => QUARANTINED_PATHS.has(entry.relativePath));

describe('mobile test files', () => {
  test('discovery finds every test file on disk', () => {
    expect(discovered.length).toBeGreaterThan(200);
  });

  test('every quarantined path still exists', () => {
    const onDisk = new Set(discovered.map((entry) => entry.relativePath));
    const missing = QUARANTINED_MOBILE_TESTS.map(([path]) => path).filter(
      (path) => !onDisk.has(path),
    );

    expect(
      missing,
      'a quarantined file was moved or removed; update quarantine.ts',
    ).toEqual([]);
  });
});

describe.concurrent('mobile suite', () => {
  for (const entry of active) {
    test.concurrent(
      entry.relativePath,
      async () => {
        const result = await runLegacyTest(entry.absolutePath);
        expect(result.code, result.output.slice(-2000)).toBe(0);
      },
      PER_FILE_TIMEOUT_MS + 5_000,
    );
  }
});

// A quarantined file must keep failing. The moment one is fixed this reports
// "expected to fail" and forces its removal from the list, so the quarantine
// can only shrink.
describe.concurrent('quarantined (known-failing, see quarantine.ts)', () => {
  for (const entry of quarantined) {
    test.concurrent.fails(
      entry.relativePath,
      async () => {
        const result = await runLegacyTest(entry.absolutePath);
        expect(result.code, result.output.slice(-2000)).toBe(0);
      },
      PER_FILE_TIMEOUT_MS + 5_000,
    );
  }
});
