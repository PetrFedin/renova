import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflows = [
  {
    path: '.github/workflows/external-staging-release.yml',
    runtimePath: '$RUNNER_TEMP/renova-external-staging',
  },
  {
    path: '.github/workflows/load-slo-integrity.yml',
    runtimePath: '$RUNNER_TEMP/renova-load-slo',
  },
];

test('external gates derive runner temp paths only after runner allocation', () => {
  for (const item of workflows) {
    const source = fs.readFileSync(item.path, 'utf8');
    assert.equal(
      source.includes('${{ runner.temp }}'),
      false,
      `${item.path} must not use runner context in job-level expressions`,
    );
    assert.equal(
      source.includes(item.runtimePath),
      true,
      `${item.path} must initialize evidence paths from shell RUNNER_TEMP`,
    );
    assert.equal(
      source.includes('GITHUB_ENV'),
      true,
      `${item.path} must export runtime-derived paths to subsequent steps`,
    );
  }
});
