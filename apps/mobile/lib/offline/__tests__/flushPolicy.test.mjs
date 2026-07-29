/** Node smoke for offline flush policy (A-01). Run: node apps/mobile/lib/offline/__tests__/flushPolicy.test.mjs */
import assert from 'node:assert/strict';

const MAX = 5;
const BASE = 5_000;
const MAX_DELAY = 5 * 60_000;

function isPermanentClientError(status) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function retryDelayMs(attempts, retryAfterMs) {
  const exponential = Math.min(MAX_DELAY, BASE * 2 ** Math.max(0, attempts - 1));
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return exponential;
  return Math.min(MAX_DELAY, Math.max(exponential, retryAfterMs));
}

function decideFlushOutcome(status, message, currentAttempts, now = Date.now(), retryAfterMs) {
  if (status !== null && status >= 200 && status < 300) return { action: 'drop' };
  if (status === 409) return { action: 'conflict', message };
  const attempts = currentAttempts + 1;
  if (status !== null && isPermanentClientError(status)) {
    return { action: 'block', message, attempts };
  }
  const blocked = attempts >= MAX;
  return {
    action: 'retry',
    message,
    attempts,
    blocked,
    nextAttemptAt: blocked ? undefined : now + retryDelayMs(attempts, retryAfterMs),
  };
}

const now = 1_800_000_000_000;
assert.equal(decideFlushOutcome(200, 'ok', 0, now).action, 'drop');
assert.equal(decideFlushOutcome(409, 'conflict', 0, now).action, 'conflict');
assert.equal(decideFlushOutcome(400, 'bad', 0, now).action, 'block');
assert.equal(decideFlushOutcome(404, 'missing', 0, now).action, 'block');
assert.equal(decideFlushOutcome(500, 'err', 0, now).nextAttemptAt, now + BASE);
assert.equal(decideFlushOutcome(503, 'err', 4, now).blocked, true);
assert.equal(decideFlushOutcome(429, 'rate', 0, now, 60_000).nextAttemptAt, now + 60_000);
assert.equal(decideFlushOutcome(null, 'network', 4, now).blocked, true);
assert.equal(retryDelayMs(20), MAX_DELAY);

console.log('OK offline flushPolicy (conflict manual / 4xx block / bounded retry backoff)');
