import assert from 'node:assert/strict';

import { mergeQueueFlushMutations } from './queueMerge';

type Job = {
  id: string;
  version?: number;
  value: string;
};

const newJob: Job = { id: 'new', version: 0, value: 'created-during-flush' };
const removed = mergeQueueFlushMutations<Job>(
  [{ id: 'a', version: 0, value: 'old' }, newJob],
  [{ id: 'a', expectedVersion: 0, next: null }],
);
assert.deepEqual(removed, [newJob], 'newly enqueued jobs survive flush completion');

const manuallyChanged: Job = { id: 'a', version: 1, value: 'manual-retry' };
const staleUpdate = mergeQueueFlushMutations<Job>(
  [manuallyChanged],
  [{ id: 'a', expectedVersion: 0, next: { id: 'a', version: 0, value: 'network-result' } }],
);
assert.deepEqual(staleUpdate, [manuallyChanged], 'stale network result cannot overwrite manual change');

const updated = mergeQueueFlushMutations<Job>(
  [{ id: 'a', version: 2, value: 'before' }],
  [{ id: 'a', expectedVersion: 2, next: { id: 'a', version: 2, value: 'after' } }],
);
assert.deepEqual(updated, [{ id: 'a', version: 3, value: 'after' }]);

const alreadyRemoved = mergeQueueFlushMutations<Job>(
  [],
  [{ id: 'a', expectedVersion: 0, next: { id: 'a', version: 0, value: 'late-result' } }],
);
assert.deepEqual(alreadyRemoved, [], 'manual deletion is not undone by late network result');

console.log('queueMerge.test OK');
