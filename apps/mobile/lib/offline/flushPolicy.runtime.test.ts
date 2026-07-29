import assert from 'node:assert/strict';

import {
  FLUSH_MAX_ATTEMPTS,
  FLUSH_RETRY_BASE_MS,
  FLUSH_RETRY_MAX_MS,
  decideFlushOutcome,
  parseRetryAfterMs,
  retryDelayMs,
} from './flushPolicy';

const now = 1_800_000_000_000;

assert.deepEqual(decideFlushOutcome(204, 'ok', 0, now), { action: 'drop' });
assert.deepEqual(decideFlushOutcome(409, 'conflict', 0, now), {
  action: 'conflict',
  message: 'conflict',
});
assert.deepEqual(decideFlushOutcome(422, 'invalid', 0, now), {
  action: 'block',
  message: 'invalid',
  attempts: 1,
});

const firstRetry = decideFlushOutcome(503, 'temporary', 0, now);
assert.equal(firstRetry.action, 'retry');
if (firstRetry.action === 'retry') {
  assert.equal(firstRetry.attempts, 1);
  assert.equal(firstRetry.blocked, false);
  assert.equal(firstRetry.nextAttemptAt, now + FLUSH_RETRY_BASE_MS);
}

const finalRetry = decideFlushOutcome(null, 'network', FLUSH_MAX_ATTEMPTS - 1, now);
assert.equal(finalRetry.action, 'retry');
if (finalRetry.action === 'retry') {
  assert.equal(finalRetry.blocked, true);
  assert.equal(finalRetry.nextAttemptAt, undefined);
}

assert.equal(retryDelayMs(20), FLUSH_RETRY_MAX_MS);
assert.equal(retryDelayMs(1, 60_000), 60_000);
assert.equal(parseRetryAfterMs('30', now), 30_000);
assert.equal(parseRetryAfterMs(new Date(now + 45_000).toUTCString(), now), 45_000);
assert.equal(parseRetryAfterMs('invalid', now), undefined);

console.log('flushPolicy.runtime.test OK');
