import assert from 'node:assert/strict';
import { resolveActiveProjectId } from './resolveActiveProjectId';

const projects = [{ id: 'a' }, { id: 'b' }];

assert.equal(resolveActiveProjectId([], 'a'), null);
assert.equal(resolveActiveProjectId(projects, 'b'), 'b');
assert.equal(resolveActiveProjectId(projects, 'missing'), 'a');
assert.equal(resolveActiveProjectId(
  [{ id: 'w', name: 'Wizard Test' }, { id: 'apt', name: 'Демо-квартира' }],
  'w',
), 'apt');
assert.equal(resolveActiveProjectId(projects, null), 'a');

console.log('resolveActiveProjectId.test OK');
