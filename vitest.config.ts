import { defineConfig } from 'vitest/config';

/**
 * Vitest is the runner; it is not (yet) the test format.
 *
 * 109 of the 226 mobile test files use `__dirname`, i.e. they are CommonJS
 * scripts that assert by `throw`, with no `describe`/`it`. Loading them
 * directly under Vitest's ESM transform would break them, and rewriting 226
 * files is a separate, reviewable change.
 *
 * So `include` deliberately points at one spec — the legacy bridge — which
 * discovers every `*.test.ts` / `*.test.mjs` under apps/mobile and runs each in
 * the exact interpreter and environment `npm run mobile:test` uses. What this
 * buys is the thing that was actually missing: automatic discovery. Adding a
 * test file no longer requires editing a 7000-character `&&` chain in
 * package.json, which is why 118 files had never run at all.
 *
 * Native Vitest specs can be added as `*.vitest.ts` and are picked up here too.
 */
export default defineConfig({
  test: {
    include: [
      'apps/mobile/vitest/legacyMobileSuite.test.ts',
      'apps/mobile/**/*.vitest.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**'],
    // Each legacy case spawns its own interpreter, so the work is already
    // parallel inside the bridge spec.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
});
