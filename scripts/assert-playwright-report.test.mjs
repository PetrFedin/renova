import assert from 'node:assert/strict';
import { validatePlaywrightStats } from './assert-playwright-report.mjs';

const healthy = validatePlaywrightStats({
  expected: 32,
  skipped: 0,
  unexpected: 0,
  flaky: 0,
});
assert.equal(healthy.ok, true, 'fully executed suite must pass');

const allSkipped = validatePlaywrightStats({
  expected: 0,
  skipped: 31,
  unexpected: 0,
  flaky: 0,
});
assert.equal(allSkipped.ok, false, 'all-skipped suite must fail');
assert.match(allSkipped.errors.join(' '), /below required minimum/);
assert.match(allSkipped.errors.join(' '), /skipped tests 31/);

const partialSkip = validatePlaywrightStats({
  expected: 30,
  skipped: 1,
  unexpected: 0,
  flaky: 0,
});
assert.equal(partialSkip.ok, false, 'unexpected skips must fail closed');

const unexpected = validatePlaywrightStats({
  expected: 30,
  skipped: 0,
  unexpected: 1,
  flaky: 0,
});
assert.equal(unexpected.ok, false, 'unexpected test result must fail');

const flaky = validatePlaywrightStats({
  expected: 30,
  skipped: 0,
  unexpected: 0,
  flaky: 1,
});
assert.equal(flaky.ok, false, 'flaky result must fail without retries');

console.log('assert-playwright-report.test OK');
