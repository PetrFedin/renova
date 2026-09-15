import assert from 'node:assert/strict';

import { shouldQueueReplaySafeMutation } from './failurePolicy';

assert.equal(shouldQueueReplaySafeMutation({ status: 0, code: 'network' }), true);
assert.equal(shouldQueueReplaySafeMutation({ status: 0, code: 'timeout' }), true);
assert.equal(shouldQueueReplaySafeMutation({ status: 429, code: 'rate_limit' }), true);
assert.equal(shouldQueueReplaySafeMutation({ status: 500 }), true);
assert.equal(shouldQueueReplaySafeMutation({ status: 503 }), true);

assert.equal(shouldQueueReplaySafeMutation({ status: 400 }), false);
assert.equal(shouldQueueReplaySafeMutation({ status: 401 }), false);
assert.equal(shouldQueueReplaySafeMutation({ status: 403 }), false);
assert.equal(shouldQueueReplaySafeMutation({ status: 409, code: 'idempotency_conflict' }), false);
assert.equal(shouldQueueReplaySafeMutation({ status: 422 }), false);

assert.equal(shouldQueueReplaySafeMutation({ name: 'AbortError' }), false);
assert.equal(shouldQueueReplaySafeMutation({ status: 409, code: 'session_generation_changed' }), false);
assert.equal(shouldQueueReplaySafeMutation(new SyntaxError('malformed 2xx body')), true);
assert.equal(shouldQueueReplaySafeMutation(new TypeError('Failed to fetch')), true);
assert.equal(shouldQueueReplaySafeMutation(new Error('programming bug')), false);
assert.equal(shouldQueueReplaySafeMutation(null), false);

console.log('failurePolicy.test OK');
