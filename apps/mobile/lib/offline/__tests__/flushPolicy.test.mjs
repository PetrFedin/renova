/** Node smoke for offline flush policy (A-01). Run: node apps/mobile/lib/offline/__tests__/flushPolicy.test.mjs */
import assert from 'node:assert/strict';

function isPermanentClientError(status) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function decideFlushOutcome(status, message, currentAttempts) {
  const MAX = 5;
  if (status === null) {
    const attempts = currentAttempts + 1;
    return { action: 'retry', message, attempts, blocked: attempts >= MAX };
  }
  if (status >= 200 && status < 300) return { action: 'drop' };
  if (status === 409) return { action: 'conflict', message };
  if (isPermanentClientError(status)) return { action: 'block', message };
  const attempts = currentAttempts + 1;
  return { action: 'retry', message, attempts, blocked: attempts >= MAX };
}

assert.equal(decideFlushOutcome(200, 'ok', 0).action, 'drop');
assert.equal(decideFlushOutcome(409, 'conflict', 0).action, 'conflict');
assert.equal(decideFlushOutcome(400, 'bad', 0).action, 'block');
assert.equal(decideFlushOutcome(404, 'missing', 0).action, 'block');
assert.equal(decideFlushOutcome(500, 'err', 0).action, 'retry');
assert.equal(decideFlushOutcome(503, 'err', 4).blocked, true);
assert.equal(decideFlushOutcome(429, 'rate', 0).action, 'retry');
assert.equal(decideFlushOutcome(null, 'network', 4).blocked, true);

console.log('OK offline flushPolicy (409 / 4xx permanent / 5xx retry)');
