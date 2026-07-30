import assert from 'node:assert/strict';
import {
  asyncShowEmpty,
  asyncShowError,
  asyncShowStale,
  idleAsyncResource,
  reduceAsyncResource,
} from './asyncResource';

const keyA = 'resource:user:project-a';
const keyB = 'resource:user:project-b';

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, { type: 'start', contextKey: keyA });
  resource = reduceAsyncResource(resource, {
    type: 'failure',
    contextKey: keyA,
    error: { status: 500, message: 'server' },
  });
  assert.equal(resource.status, 'error');
  assert.equal(resource.data, null);
  assert.equal(asyncShowError(resource), true);
  assert.equal(asyncShowEmpty(resource), false, 'load error must never become empty');
}

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, {
    type: 'success',
    contextKey: keyA,
    data: ['task-a'],
  });
  resource = reduceAsyncResource(resource, {
    type: 'start',
    contextKey: keyA,
    soft: true,
  });
  assert.equal(resource.status, 'refreshing');
  assert.deepEqual(resource.data, ['task-a']);
  resource = reduceAsyncResource(resource, {
    type: 'failure',
    contextKey: keyA,
    error: { status: 504, message: 'timeout' },
  });
  assert.equal(resource.status, 'stale');
  assert.deepEqual(resource.data, ['task-a']);
  assert.equal(asyncShowStale(resource), true);
}

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, {
    type: 'success',
    contextKey: keyA,
    data: [],
  });
  assert.equal(resource.status, 'empty');
  assert.equal(asyncShowEmpty(resource), true);
}

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, {
    type: 'success',
    contextKey: keyA,
    data: ['cached'],
    stale: true,
  });
  assert.equal(resource.status, 'stale');
  assert.deepEqual(resource.data, ['cached']);
}

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, { type: 'context', contextKey: keyB });
  resource = reduceAsyncResource(resource, {
    type: 'success',
    contextKey: keyA,
    data: ['wrong-project'],
  });
  assert.equal(resource.contextKey, keyB);
  assert.equal(resource.status, 'idle');
  assert.equal(resource.data, null, 'old-project response must be ignored');
}

{
  let resource = idleAsyncResource<string[]>(keyA);
  resource = reduceAsyncResource(resource, {
    type: 'failure',
    contextKey: keyA,
    error: new Error('offline'),
    offline: true,
  });
  assert.equal(resource.status, 'offline');
  assert.equal(resource.data, null);
  assert.equal(asyncShowError(resource), true);
  assert.equal(asyncShowEmpty(resource), false);
}

console.log('asyncResource.test OK');
