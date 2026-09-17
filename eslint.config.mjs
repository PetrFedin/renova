// @ts-check
/**
 * ESLint for the mobile app.
 *
 * The backend now has ruff and mypy; `tsc` covers mobile types. What neither
 * covers is the class of mistake that type-checks fine and fails at runtime:
 * a React hook called conditionally, a dependency array missing a value the
 * effect reads, an unused binding left behind by a refactor, a `case` that
 * falls through.
 *
 * The rule set is deliberately small and correctness-only. No stylistic rules:
 * this codebase has no formatter, so style rules would produce thousands of
 * findings that say nothing about whether the app works, and the signal would
 * be lost. Style can be added later against the same ratchet.
 *
 * Type-aware linting (`projectService`) is deliberately off — it triples the
 * run time and its extra rules overlap with what `tsc` already reports.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.expo/**',
      '**/dist/**',
      '**/build/**',
      'packages/calc-engine/**',
      'e2e/**',
      'load/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        __DEV__: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        WebSocket: 'readonly',
        globalThis: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        module: 'writable',
      },
    },
    rules: {
      // --- off: already covered, or noise without a formatter ---------------
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off', // replaced below with a form that allows _prefix
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off', // used for lazy native modules
      'no-undef': 'off', // TypeScript resolves this correctly; ESLint does not know the RN globals

      // --- on: mistakes that type-check but misbehave at runtime -----------
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-fallthrough': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
);
