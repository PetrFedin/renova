import assert from 'node:assert/strict';
import { resolvePaymentTarget, targetFirst } from './actionQueueTargetFocus';

const first = { id: 'p1', status: 'pending' };
const second = { id: 'p2', status: 'paid_unverified' };
const records = [first, second];

assert.deepEqual(resolvePaymentTarget(records, 'p2', undefined, true), { kind: 'found', payment: second });
assert.deepEqual(resolvePaymentTarget(records, 'wrong', '1', true), { kind: 'missing', payment: null },
  'explicit missing ID must never open another pending payment');
assert.deepEqual(resolvePaymentTarget(records, 'wrong', undefined, false), { kind: 'waiting', payment: null },
  'missing ID must not be asserted before project data finishes loading');
assert.deepEqual(resolvePaymentTarget(records, undefined, 'true', true), { kind: 'found', payment: first });
assert.deepEqual(resolvePaymentTarget([second], undefined, 'true', true), { kind: 'none', payment: null });
assert.deepEqual(resolvePaymentTarget(records, undefined, undefined, true), { kind: 'none', payment: null });
assert.deepEqual(resolvePaymentTarget([], 'p1', undefined, true), { kind: 'missing', payment: null });
assert.deepEqual(resolvePaymentTarget(records, ' ', undefined, true), { kind: 'missing', payment: null });

assert.deepEqual(targetFirst(records, 'p2'), [second, first], 'matching ID should be promoted');
assert.deepEqual(targetFirst(records, 'missing'), records, 'missing ID never selects arbitrary target');
assert.deepEqual(targetFirst(records), records);
assert.deepEqual(records, [first, second], 'sorting must not mutate server read model');

console.log('actionQueueTargetFocus.test OK');
